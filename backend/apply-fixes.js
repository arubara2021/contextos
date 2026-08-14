const fs = require('fs');
const path = require('path');

const filePath = path.join('src', 'api', 'documents.routes.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Find the start of the upload route
const startRegex = /router\.post\(\s*["']\/upload["']/;
const startMatch = content.match(startRegex);
if (!startMatch) {
  console.error("❌ Could not find the start of the /upload route.");
  process.exit(1);
}
const startIdx = startMatch.index;

// Find the end of the route (the next router.get, router.post, router.delete, or export default)
const restOfContent = content.substring(startIdx);
const endRegex = /\nrouter\.(get|post|put|delete|patch)\(|\nexport default router;/;
const endMatch = restOfContent.match(endRegex);

if (!endMatch) {
  console.error("❌ Could not find the end of the /upload route.");
  process.exit(1);
}

const endIdx = startIdx + endMatch.index;
console.log("🔧 Found /upload route. Replacing it with the clean Trigger.dev version...");

const newRoute = `router.post(
  "/upload",
  authMiddleware,
  upload.single("file"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const file = req.file;

      if (!req.userId || !isValidUuid(req.userId)) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      if (!file) {
        res.status(400).json({ error: "No file provided" });
        return;
      }

      if (file.size === 0) {
        res.status(400).json({ error: "File is empty" });
        return;
      }

      const { userStore } = getDependencies();
      const owner = await userStore.getUserById(req.userId);

      if (owner?.isSandbox) {
        const allowed = await userStore.tryConsumeSandboxUpload(
          owner.userId,
          SANDBOX_MAX_UPLOADS
        );

        if (!allowed) {
          res.status(429).json({
            error: \`Sandbox upload limit reached (\${SANDBOX_MAX_UPLOADS} files max)\`,
          });
          return;
        }
      }

      const fileType = getFileExtension(file.originalname);
      const format = toFileFormat(fileType);
      const jobId = randomUUID();
      const mimeType = file.mimetype;

      const fileLocator = await storeUploadedFile({
        userId: req.userId,
        filename: file.originalname,
        fileType,
        format,
        mimeType,
        sizeBytes: file.size,
        fileBuffer: file.buffer,
      });

      await query(
        \`INSERT INTO processing_jobs (
          job_id, user_id, filename, file_type, format, mime_type, size_bytes,
          status, stage, progress, message, started_at
        ) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, 'queued', 'uploaded', 0, 'File uploaded, processing queued', now())\`,
        [jobId, req.userId, file.originalname, fileType, format, mimeType, file.size]
      );

      await updateJob(jobId, {
        s3Key: fileLocator,
      });

      // --- TRIGGER.DEV BACKGROUND PROCESSING ---
      let triggerSucceeded = false;
      try {
        const { processDocumentTask } = await import("../tasks/document-processing.task");
        await processDocumentTask.trigger({ jobId, userId: req.userId });
        logger.info("=== TRIGGER.DEV SUCCESS ===", { jobId });
        triggerSucceeded = true;
      } catch (triggerError) {
        logger.error("=== TRIGGER.DEV FAILED ===", {
          jobId,
          errorMessage: (triggerError as Error).message,
        });
      }

      if (!triggerSucceeded) {
        logger.info("=== FALLING BACK TO LOCAL PROCESSING ===", { jobId });
        const work = processDocumentAsync(
          jobId, req.userId, file.originalname, fileType, format,
          mimeType, file.size, file.buffer
        ).catch((err) => {
          logger.error("Background processing unhandled error", { jobId, error: (err as Error).message });
        });
        try {
          const { waitUntil } = await import("@vercel/functions");
          waitUntil(work);
        } catch { void work; }
      }

      res.status(202).json({
        jobId,
        filename: file.originalname,
        fileType,
        format,
        sizeBytes: file.size,
        status: "processing",
      });
    } catch (error) {
      const err = error as Error;

      if (err.message.includes("Unsupported file type")) {
        res.status(415).json({ error: err.message });
        return;
      }

      if (err.message.includes("File too large")) {
        res.status(413).json({ error: "File exceeds maximum size of 4MB (Vercel limit)" });
        return;
      }

      logger.error("POST /documents/upload failed", {
        filename: req.file?.originalname,
        error: err.message,
      });

      res.status(500).json({ error: "Failed to process document" });
    }
  }
);
`;

const newContent = content.substring(0, startIdx) + newRoute + content.substring(endIdx);
fs.writeFileSync(filePath, newContent, 'utf8');
console.log("✅ Successfully patched documents.routes.ts!");
console.log("Now run: npx tsc --noEmit");