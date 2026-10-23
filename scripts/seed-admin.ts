import "dotenv/config";
import { PrismaClient, Role } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";

export interface SeedAdminOptions {
  email?: string;
  name?: string;
  password?: string;
  forceReset?: boolean;
  prismaClient?: PrismaClient;
}

export function validateAdminPasswordStrength(password: string): void {
  if (!password || password.length < 12) {
    throw new Error("INITIAL_ADMIN_PASSWORD must be at least 12 characters long.");
  }
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigitOrSpecial = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);
  if (!hasUpper || !hasLower || !hasDigitOrSpecial) {
    throw new Error(
      "INITIAL_ADMIN_PASSWORD must contain uppercase, lowercase, and numeric or special characters."
    );
  }
}

export async function bootstrapAdmin(options?: SeedAdminOptions) {
  const prisma = options?.prismaClient ?? new PrismaClient();
  const shouldDisconnect = !options?.prismaClient;

  try {
    const email = (options?.email || process.env.INITIAL_ADMIN_EMAIL || "admin@nuasknust.org").trim().toLowerCase();
    const name = (options?.name || process.env.INITIAL_ADMIN_NAME || "NUAS Executive Super Admin").trim();
    const rawPassword = options && "password" in options ? options.password : process.env.INITIAL_ADMIN_PASSWORD;
    const password = rawPassword?.trim();
    const forceReset = options?.forceReset ?? process.argv.includes("--force-reset");

    if (!email) {
      throw new Error("INITIAL_ADMIN_EMAIL must be explicitly provided in environment variables or options.");
    }

    if (!password) {
      throw new Error("INITIAL_ADMIN_PASSWORD must be explicitly provided via environment variables or bootstrap options. Default passwords have been removed for security.");
    }

    validateAdminPasswordStrength(password);

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      if (!forceReset) {
        console.log(`[seed-admin] Administrator with email "${email}" already exists. Preserving existing password.`);
        console.log(`[seed-admin] To overwrite the password explicitly, pass --force-reset.`);
        return {
          status: "SKIPPED_EXISTING",
          user: { id: existingUser.id, email: existingUser.email, role: existingUser.role },
        };
      }

      // Overwrite requested with --force-reset
      const passwordHash = await hashPassword(password);
      const updatedUser = await prisma.user.update({
        where: { email },
        data: {
          passwordHash,
          name,
          role: Role.SUPER_ADMIN,
          isActive: true,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: updatedUser.id,
          action: "BOOTSTRAP_ADMIN_PASSWORD_RESET",
          entity: "User",
          entityId: updatedUser.id,
          details: { email: updatedUser.email, role: updatedUser.role, resetVia: "CLI" },
        },
      });

      console.log(`[seed-admin] Administrator password updated successfully for "${email}".`);
      return {
        status: "UPDATED",
        user: { id: updatedUser.id, email: updatedUser.email, role: updatedUser.role },
      };
    }

    // Create new super admin
    const passwordHash = await hashPassword(password);
    const newUser = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: Role.SUPER_ADMIN,
        isActive: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: newUser.id,
        action: "BOOTSTRAP_ADMIN_CREATED",
        entity: "User",
        entityId: newUser.id,
        details: { email: newUser.email, role: newUser.role, provisionedVia: "CLI" },
      },
    });

    console.log(`[seed-admin] Initial Super Administrator "${newUser.name}" (${newUser.email}) created successfully.`);
    return {
      status: "CREATED",
      user: { id: newUser.id, email: newUser.email, role: newUser.role },
    };
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}

// Auto-execute when run as script
if (require.main === module) {
  bootstrapAdmin()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error("[seed-admin] Error bootstrapping administrator:", err.message);
      process.exit(1);
    });
}
