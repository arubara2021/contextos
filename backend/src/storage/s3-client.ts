import {
  S3Client as AWSS3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import config from "../config";
import logger from "../utils/logger";
import { Readable } from "stream";

export interface UploadResult {
  key: string;
  bucket: string;
  etag: string | undefined;
  size: number;
}

export interface ListResult {
  key: string;
  size: number;
  lastModified: Date | undefined;
}

export class S3StorageClient {
  private readonly client: AWSS3Client;
  private readonly bucket: string;
  private availabilityCache: boolean | null = null;

  constructor() {
    this.client = new AWSS3Client({
      region: config.aws.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
      maxAttempts: 3,
      requestHandler: {
        requestTimeout: 30000,
      },
    });
    this.bucket = config.s3.bucketName;
  }

  private isMissingBucketError(error: unknown): boolean {
    const name = (error as { name?: string })?.name || "";
    const message = (error as Error)?.message || "";
    return (
      name === "NoSuchBucket" ||
      /NoSuchBucket/i.test(message) ||
      /The specified bucket does not exist/i.test(message)
    );
  }

  async isAvailable(): Promise<boolean> {
    if (this.availabilityCache !== null) return this.availabilityCache;
    try {
      await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 })
      );
      this.availabilityCache = true;
      return true;
    } catch (error) {
      if (this.isMissingBucketError(error)) {
        this.availabilityCache = false;
        logger.debug("S3 bucket not available; storage features use DB fallback", {
          bucket: this.bucket,
        });
        return false;
      }
      logger.debug("S3 availability probe failed (transient); treating as unavailable", {
        error: (error as Error).message,
      });
      return false;
    }
  }

  async upload(
    key: string,
    content: Buffer | string,
    contentType: string
  ): Promise<UploadResult> {
    try {
      const body =
        typeof content === "string" ? Buffer.from(content, "utf-8") : content;
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
        Metadata: {
          uploadedAt: new Date().toISOString(),
        },
      });
      const response = await this.client.send(command);
      logger.debug("S3 upload successful", {
        key,
        bucket: this.bucket,
        size: body.length,
      });
      return {
        key,
        bucket: this.bucket,
        etag: response.ETag,
        size: body.length,
      };
    } catch (error) {
      if (this.isMissingBucketError(error)) {
        this.availabilityCache = false;
      }
      logger.error("S3 upload failed", {
        key,
        bucket: this.bucket,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async download(key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const response = await this.client.send(command);
      if (!response.Body) {
        throw new Error(`Empty response body for key: ${key}`);
      }
      return this.streamToBuffer(response.Body as Readable);
    } catch (error) {
      const err = error as Error;
      if (err.name === "NoSuchKey" || err.message.includes("NoSuchKey")) {
        logger.warn("S3 object not found", { key });
        throw new Error(`Object not found: ${key}`);
      }
      logger.error("S3 download failed", {
        key,
        error: err.message,
      });
      throw error;
    }
  }

  async downloadAsString(key: string): Promise<string> {
    const buffer = await this.download(key);
    return buffer.toString("utf-8");
  }

  async delete(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(command);
      logger.debug("S3 delete successful", { key });
    } catch (error) {
      logger.error("S3 delete failed", {
        key,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch (error) {
      const err = error as Error;
      if (
        err.name === "NotFound" ||
        err.name === "NoSuchKey" ||
        (err as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      ) {
        return false;
      }
      logger.error("S3 exists check failed", {
        key,
        error: err.message,
      });
      throw error;
    }
  }

  async listDocuments(prefix?: string): Promise<ListResult[]> {
    try {
      const results: ListResult[] = [];
      let continuationToken: string | undefined;
      do {
        const command = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        });
        const response = await this.client.send(command);
        if (response.Contents) {
          for (const item of response.Contents) {
            if (item.Key) {
              results.push({
                key: item.Key,
                size: item.Size ?? 0,
                lastModified: item.LastModified,
              });
            }
          }
        }
        continuationToken = response.NextContinuationToken;
      } while (continuationToken);
      return results;
    } catch (error) {
      logger.error("S3 listDocuments failed", {
        prefix,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const url = await getSignedUrl(this.client, command, { expiresIn });
      logger.debug("Generated presigned URL", {
        key,
        expiresIn,
      });
      return url;
    } catch (error) {
      logger.error("S3 getPresignedUrl failed", {
        key,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number = 3600
  ): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      });
      const url = await getSignedUrl(this.client, command, { expiresIn });
      logger.debug("Generated presigned upload URL", {
        key,
        contentType,
        expiresIn,
      });
      return url;
    } catch (error) {
      logger.error("S3 getPresignedUploadUrl failed", {
        key,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getStorageUsage(prefix?: string): Promise<{
    totalSize: number;
    objectCount: number;
  }> {
    if (!(await this.isAvailable())) {
      return { totalSize: 0, objectCount: 0 };
    }
    try {
      let totalSize = 0;
      let objectCount = 0;
      let continuationToken: string | undefined;
      do {
        const command = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        });
        const response = await this.client.send(command);
        if (response.Contents) {
          for (const item of response.Contents) {
            totalSize += item.Size ?? 0;
            objectCount++;
          }
        }
        continuationToken = response.NextContinuationToken;
      } while (continuationToken);
      return { totalSize, objectCount };
    } catch (error) {
      if (this.isMissingBucketError(error)) {
        this.availabilityCache = false;
        logger.debug("S3 getStorageUsage: bucket unavailable, returning zeros", {
          prefix,
        });
        return { totalSize: 0, objectCount: 0 };
      }
      logger.error("S3 getStorageUsage failed", {
        prefix,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getMetadata(key: string): Promise<{
    contentType: string | undefined;
    contentLength: number | undefined;
    lastModified: Date | undefined;
    etag: string | undefined;
  }> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const response = await this.client.send(command);
      return {
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        lastModified: response.LastModified,
        etag: response.ETag,
      };
    } catch (error) {
      logger.error("S3 getMetadata failed", {
        key,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async move(sourceKey: string, destKey: string): Promise<void> {
    try {
      const content = await this.download(sourceKey);
      const metadata = await this.getMetadata(sourceKey);
      await this.upload(destKey, content, metadata.contentType ?? "application/octet-stream");
      await this.delete(sourceKey);
      logger.debug("S3 move successful", {
        sourceKey,
        destKey,
      });
    } catch (error) {
      logger.error("S3 move failed", {
        sourceKey,
        destKey,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async copy(sourceKey: string, destKey: string): Promise<void> {
    try {
      const content = await this.download(sourceKey);
      const metadata = await this.getMetadata(sourceKey);
      await this.upload(destKey, content, metadata.contentType ?? "application/octet-stream");
      logger.debug("S3 copy successful", {
        sourceKey,
        destKey,
      });
    } catch (error) {
      logger.error("S3 copy failed", {
        sourceKey,
        destKey,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    try {
      const objects = await this.listDocuments(prefix);
      let deleted = 0;
      for (const obj of objects) {
        try {
          await this.delete(obj.key);
          deleted++;
        } catch (error) {
          logger.debug("Failed to delete object during prefix cleanup", {
            key: obj.key,
            error: (error as Error).message,
          });
        }
      }
      logger.info("S3 deleteByPrefix complete", {
        prefix,
        total: objects.length,
        deleted,
      });
      return deleted;
    } catch (error) {
      logger.error("S3 deleteByPrefix failed", {
        prefix,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on("end", () => {
        resolve(Buffer.concat(chunks));
      });
      stream.on("error", (err: Error) => {
        reject(err);
      });
    });
  }
}

let s3ClientInstance: S3StorageClient | null = null;

export function getS3Client(): S3StorageClient {
  if (!s3ClientInstance) {
    s3ClientInstance = new S3StorageClient();
  }
  return s3ClientInstance;
}