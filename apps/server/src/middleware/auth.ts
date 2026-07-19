import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "../integrations/supabase.js";
import type { AuthUser, Repository } from "../types.js";

declare global {
  namespace Express {
    interface Request {
      user: AuthUser;
    }
  }
}

export function requireAuth(repository: Repository) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
      if (!token || !supabaseAdmin) {
        return res.status(401).json({ error: "Missing bearer token", code: "unauthorized" });
      }

      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !data.user) {
        return res.status(401).json({ error: "Invalid bearer token", code: "unauthorized" });
      }

      req.user = await repository.getOrCreateProfile({
        id: data.user.id,
        email: data.user.email
      });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
