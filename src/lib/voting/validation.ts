import { z } from "zod";

/**
 * Validates Ghanaian and international phone numbers.
 * Supports:
 * - Ghana standard: 024XXXXXXX, 055XXXXXXX, 020XXXXXXX (10 digits)
 * - Ghana international: +23324XXXXXXX, +23355XXXXXXX
 * - Standard international: +[1-9][0-9]{7,14}
 */
const phoneRegex = /^(?:(?:\+233|0)[235][0-9]{8}|\+[1-9][0-9]{7,14})$/;

export const voteAllocationSchema = z.object({
  nomineeId: z.string().min(1, "Nominee ID is required"),
  numberOfVotes: z
    .number({ invalid_type_error: "Vote count must be a number" })
    .int("Vote count must be a whole integer")
    .min(1, "Each allocation must be at least 1 vote")
    .max(10000, "Maximum 10,000 votes per nominee allocation"),
});

export const checkoutRequestSchema = z
  .object({
    eventId: z.string().min(1, "Event ID is required"),
    voterPhone: z
      .string()
      .trim()
      .regex(
        phoneRegex,
        "Please provide a valid phone number (e.g., 024XXXXXXX or +233XXXXXXXXX)"
      ),
    voterEmail: z
      .string({ required_error: "Email address is required for your official digital voting receipt." })
      .trim()
      .email("Please provide a valid email address for your official digital voting receipt."),
    allocations: z
      .array(voteAllocationSchema)
      .min(1, "Your cart must contain at least one nominee allocation")
      .max(50, "A single order cannot contain more than 50 nominee allocations"),
    idempotencyKey: z
      .string()
      .trim()
      .min(8, "Idempotency key must be at least 8 characters")
      .max(128, "Idempotency key cannot exceed 128 characters")
      .optional(),
  })
  .refine(
    (data) => {
      const nomineeIds = data.allocations.map((a) => a.nomineeId);
      const uniqueIds = new Set(nomineeIds);
      return uniqueIds.size === nomineeIds.length;
    },
    {
      message: "Duplicate nominee allocations are not permitted in a single checkout order.",
      path: ["allocations"],
    }
  );

export type CheckoutRequestInput = z.infer<typeof checkoutRequestSchema>;

export const sandboxSimulationSchema = z.object({
  orderNumber: z.string().min(1, "Order number is required"),
  outcome: z.enum(["SUCCESS", "FAILED", "CANCELLED"]),
  amountInPesewas: z.number().int().positive().optional(),
  currency: z.string().optional(),
});

export type SandboxSimulationInput = z.infer<typeof sandboxSimulationSchema>;
