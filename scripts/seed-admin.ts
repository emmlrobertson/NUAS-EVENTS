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

export async function bootstrapAdmin(options?: SeedAdminOptions) {
  const prisma = options?.prismaClient ?? new PrismaClient();
  const shouldDisconnect = !options?.prismaClient;

  try {
    const email = (options?.email || process.env.INITIAL_ADMIN_EMAIL || "admin@nuasknust.org").trim().toLowerCase();
    const name = (options?.name || process.env.INITIAL_ADMIN_NAME || "NUAS Executive Super Admin").trim();
    const password = options?.password || process.env.INITIAL_ADMIN_PASSWORD;
    const forceReset = options?.forceReset ?? process.argv.includes("--force-reset");

    if (!email || !password) {
      throw new Error("INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD must be configured in environment variables.");
    }

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
