import request from "supertest";
import express from "express";
import authRouter from "../../src/api/users.routes";

jest.mock("../../src/api/dependencies", () => ({
  getDependencies: jest.fn(),
}));

jest.mock("../../src/auth/tokens", () => ({
  generateToken: jest.fn(),
}));

jest.mock("../../src/auth/password", () => ({
  hashPassword: jest.fn(),
  verifyPassword: jest.fn(),
}));

jest.mock("../../src/auth/middleware", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    if (!req.headers.authorization) {
      return _res.status(401).json({ error: "No token provided" });
    }
    try {
      const { verifyToken } = require("../../src/auth/jwt");
      const token = req.headers.authorization.replace("Bearer ", "");
      const decoded = verifyToken(token);
      req.userId = decoded.userId;
      next();
    } catch {
      _res.status(401).json({ error: "Invalid token" });
    }
  },
}));

jest.mock("../../src/auth/jwt", () => ({
  verifyToken: jest.fn(),
  signToken: jest.fn(),
}));

jest.mock("../../src/models/user.model", () => ({
  validateUserCreate: jest.fn(),
  validateUserUpdate: jest.fn(),
  validatePasswordUpdate: jest.fn(),
  validateLogin: jest.fn(),
  toUserResponse: jest.fn(),
}));

const { getDependencies } = require("../../src/api/dependencies");
const { generateToken } = require("../../src/auth/tokens");
const { hashPassword, verifyPassword } = require("../../src/auth/password");
const { verifyToken } = require("../../src/auth/jwt");
const {
  validateUserCreate,
  validateLogin,
  validateUserUpdate,
  validatePasswordUpdate,
  toUserResponse,
} = require("../../src/models/user.model");

const mockUserStore = {
  emailExists: jest.fn(),
  createUser: jest.fn(),
  getUserByEmail: jest.fn(),
  getUserById: jest.fn(),
  updateUser: jest.fn(),
  updatePassword: jest.fn(),
};

const TEST_USER = {
  userId: "user-123",
  email: "test@example.com",
  passwordHash: "$2b$12$hashedpassword",
  displayName: "Test User",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const TEST_USER_RESPONSE = {
  userId: "user-123",
  email: "test@example.com",
  displayName: "Test User",
  createdAt: TEST_USER.createdAt,
  updatedAt: TEST_USER.updatedAt,
};

const app = express();
app.use(express.json());
app.use("/api/auth", authRouter);

beforeEach(() => {
  jest.clearAllMocks();
  getDependencies.mockReturnValue({ userStore: mockUserStore });
  toUserResponse.mockReturnValue(TEST_USER_RESPONSE);
});

describe("POST /api/auth/register", () => {
  it("registers a new user successfully", async () => {
    validateUserCreate.mockReturnValue({
      params: { email: "test@example.com", password: "SecurePass123", displayName: "Test User" },
      errors: [],
    });
    mockUserStore.emailExists.mockResolvedValue(false);
    mockUserStore.createUser.mockResolvedValue(TEST_USER);
    generateToken.mockReturnValue("access-token");

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: "test@example.com",
        password: "SecurePass123",
        displayName: "Test User",
      });

    expect(res.status).toBe(201);
    expect(res.body.token).toBe("access-token");
    expect(res.body.user.email).toBe("test@example.com");
    expect(res.body.user.displayName).toBe("Test User");
  });

  it("returns 409 when email already exists", async () => {
    validateUserCreate.mockReturnValue({
      params: { email: "test@example.com", password: "SecurePass123", displayName: "Test User" },
      errors: [],
    });
    mockUserStore.emailExists.mockResolvedValue(true);

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: "test@example.com",
        password: "SecurePass123",
        displayName: "Test User",
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("already");
  });

  it("returns 400 for validation failure", async () => {
    validateUserCreate.mockReturnValue({
      params: null,
      errors: ["Invalid email format"],
    });

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: "not-an-email",
        password: "SecurePass123",
        displayName: "Test User",
      });

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing fields", async () => {
    validateUserCreate.mockReturnValue({
      params: null,
      errors: ["Email is required"],
    });

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        password: "SecurePass123",
      });

    expect(res.status).toBe(400);
  });

  it("returns 400 for weak password", async () => {
    validateUserCreate.mockReturnValue({
      params: null,
      errors: ["Password too weak"],
    });

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: "test@example.com",
        password: "123",
        displayName: "Test User",
      });

    expect(res.status).toBe(400);
  });

  it("returns token and user object on success", async () => {
    validateUserCreate.mockReturnValue({
      params: { email: "test@example.com", password: "SecurePass123", displayName: "Test User" },
      errors: [],
    });
    mockUserStore.emailExists.mockResolvedValue(false);
    mockUserStore.createUser.mockResolvedValue(TEST_USER);
    generateToken.mockReturnValue("access-token");

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: "test@example.com",
        password: "SecurePass123",
        displayName: "Test User",
      });

    expect(res.body).toHaveProperty("token");
    expect(res.body).toHaveProperty("user");
    expect(res.body.user).not.toHaveProperty("passwordHash");
    expect(res.body.user).not.toHaveProperty("password_hash");
  });

  it("handles database errors", async () => {
    validateUserCreate.mockReturnValue({
      params: { email: "test@example.com", password: "SecurePass123", displayName: "Test User" },
      errors: [],
    });
    mockUserStore.emailExists.mockRejectedValue(new Error("Connection failed"));

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: "test@example.com",
        password: "SecurePass123",
        displayName: "Test User",
      });

    expect(res.status).toBe(500);
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with valid credentials", async () => {
    validateLogin.mockReturnValue({ email: "test@example.com", password: "SecurePass123" });
    mockUserStore.getUserByEmail.mockResolvedValue(TEST_USER);
    verifyPassword.mockResolvedValue(true);
    generateToken.mockReturnValue("access-token");

    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: "test@example.com",
        password: "SecurePass123",
      });

    expect(res.status).toBe(200);
    expect(res.body.token).toBe("access-token");
    expect(res.body.user.email).toBe("test@example.com");
  });

  it("returns 401 for invalid email", async () => {
    validateLogin.mockReturnValue({ email: "nonexistent@example.com", password: "SecurePass123" });
    mockUserStore.getUserByEmail.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: "nonexistent@example.com",
        password: "SecurePass123",
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Invalid");
  });

  it("returns 401 for invalid password", async () => {
    validateLogin.mockReturnValue({ email: "test@example.com", password: "WrongPassword" });
    mockUserStore.getUserByEmail.mockResolvedValue(TEST_USER);
    verifyPassword.mockResolvedValue(false);

    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: "test@example.com",
        password: "WrongPassword",
      });

    expect(res.status).toBe(401);
  });

  it("returns 400 for missing fields", async () => {
    validateLogin.mockReturnValue(null);

    const res = await request(app)
      .post("/api/auth/login")
      .send({});

    expect(res.status).toBe(400);
  });

  it("does not expose password hash in response", async () => {
    validateLogin.mockReturnValue({ email: "test@example.com", password: "SecurePass123" });
    mockUserStore.getUserByEmail.mockResolvedValue(TEST_USER);
    verifyPassword.mockResolvedValue(true);
    generateToken.mockReturnValue("access-token");

    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: "test@example.com",
        password: "SecurePass123",
      });

    expect(res.body.user).not.toHaveProperty("passwordHash");
    expect(res.body.user).not.toHaveProperty("password_hash");
    expect(res.body.user).not.toHaveProperty("password");
  });

  it("handles database errors", async () => {
    validateLogin.mockReturnValue({ email: "test@example.com", password: "SecurePass123" });
    mockUserStore.getUserByEmail.mockRejectedValue(new Error("Connection failed"));

    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: "test@example.com",
        password: "SecurePass123",
      });

    expect(res.status).toBe(500);
  });
});

describe("GET /api/auth/me", () => {
  it("returns current user when authenticated", async () => {
    verifyToken.mockReturnValue({ userId: "user-123", email: "test@example.com" });
    mockUserStore.getUserById.mockResolvedValue(TEST_USER);

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("test@example.com");
    expect(res.body.user).not.toHaveProperty("passwordHash");
  });

  it("returns 401 without auth token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 for invalid token", async () => {
    verifyToken.mockImplementation(() => {
      throw new Error("Invalid token");
    });

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer invalid-token");

    expect(res.status).toBe(401);
  });

  it("returns 404 when user not found in database", async () => {
    verifyToken.mockReturnValue({ userId: "user-123", email: "test@example.com" });
    mockUserStore.getUserById.mockResolvedValue(null);

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/auth/me", () => {
  it("updates user profile", async () => {
    verifyToken.mockReturnValue({ userId: "user-123", email: "test@example.com" });
    validateUserUpdate.mockReturnValue({ params: { displayName: "New Name" }, errors: [] });
    mockUserStore.updateUser.mockResolvedValue({ ...TEST_USER, displayName: "New Name" });

    const res = await request(app)
      .patch("/api/auth/me")
      .set("Authorization", "Bearer valid-token")
      .send({ displayName: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
  });

  it("returns 401 without auth", async () => {
    const res = await request(app)
      .patch("/api/auth/me")
      .send({ displayName: "New Name" });

    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/auth/me/password", () => {
  it("updates password successfully", async () => {
    verifyToken.mockReturnValue({ userId: "user-123", email: "test@example.com" });
    validatePasswordUpdate.mockReturnValue({
      params: { currentPassword: "OldPass123", newPassword: "NewPass123" },
      errors: [],
    });
    mockUserStore.getUserById.mockResolvedValue(TEST_USER);
    verifyPassword.mockResolvedValue(true);
    hashPassword.mockResolvedValue("$2b$12$newhash");
    mockUserStore.updatePassword.mockResolvedValue(true);

    const res = await request(app)
      .patch("/api/auth/me/password")
      .set("Authorization", "Bearer valid-token")
      .send({ currentPassword: "OldPass123", newPassword: "NewPass123" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });

  it("returns 401 for wrong current password", async () => {
    verifyToken.mockReturnValue({ userId: "user-123", email: "test@example.com" });
    validatePasswordUpdate.mockReturnValue({
      params: { currentPassword: "WrongPass", newPassword: "NewPass123" },
      errors: [],
    });
    mockUserStore.getUserById.mockResolvedValue(TEST_USER);
    verifyPassword.mockResolvedValue(false);

    const res = await request(app)
      .patch("/api/auth/me/password")
      .set("Authorization", "Bearer valid-token")
      .send({ currentPassword: "WrongPass", newPassword: "NewPass123" });

    expect(res.status).toBe(401);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app)
      .patch("/api/auth/me/password")
      .send({ currentPassword: "OldPass123", newPassword: "NewPass123" });

    expect(res.status).toBe(401);
  });
});