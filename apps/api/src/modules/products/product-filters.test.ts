import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const inventoryRoleFilterSchema = z
  .string()
  .optional()
  .transform((val, ctx) => {
    if (!val) return undefined;
    const parts = val.split(',').map((s) => s.trim()).filter(Boolean);
    const valid = ['sellable', 'ingredient', 'both'];
    for (const p of parts) {
      if (!valid.includes(p)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid inventoryRole filter value: ${p}` });
        return z.NEVER;
      }
    }
    return parts;
  });

const statusFilterSchema = z
  .string()
  .optional()
  .transform((val, ctx) => {
    if (!val) return undefined;
    const parts = val.split(',').map((s) => s.trim()).filter(Boolean);
    const valid = ['active', 'inactive', 'pending_receipt'];
    for (const p of parts) {
      if (!valid.includes(p)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid status filter value: ${p}` });
        return z.NEVER;
      }
    }
    return parts;
  });

const preparationBehaviorFilterSchema = z
  .string()
  .optional()
  .transform((val, ctx) => {
    if (!val) return undefined;
    const parts = val.split(',').map((s) => s.trim()).filter(Boolean);
    const valid = ['standard', 'cook_to_order', 'preproduced'];
    for (const p of parts) {
      if (!valid.includes(p)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid preparationBehavior filter value: ${p}` });
        return z.NEVER;
      }
    }
    return parts;
  });

describe('Product query filters validation', () => {
  it('parses valid multi-value inventoryRole filters', () => {
    const result = inventoryRoleFilterSchema.parse('ingredient,both');
    expect(result).toEqual(['ingredient', 'both']);
  });

  it('rejects invalid inventoryRole filter values', () => {
    expect(() => inventoryRoleFilterSchema.parse('ingredient,invalid_role')).toThrow();
  });

  it('parses valid multi-value status filters', () => {
    const result = statusFilterSchema.parse('active,inactive');
    expect(result).toEqual(['active', 'inactive']);
  });

  it('rejects invalid status filter values', () => {
    expect(() => statusFilterSchema.parse('active,archived')).toThrow();
  });

  it('parses valid multi-value preparationBehavior filters', () => {
    const result = preparationBehaviorFilterSchema.parse('cook_to_order,preproduced');
    expect(result).toEqual(['cook_to_order', 'preproduced']);
  });

  it('rejects invalid preparationBehavior filter values', () => {
    expect(() => preparationBehaviorFilterSchema.parse('cook_to_order,invalid_behavior')).toThrow();
  });
});
