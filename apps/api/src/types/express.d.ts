import type { CurrentUser } from '@ximo/shared';

declare global {
  namespace Express {
    interface Request {
      authUser?: CurrentUser;
      authToken?: string;
    }
  }
}

export {};
