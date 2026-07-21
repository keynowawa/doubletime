// Setup type definitions for built-in Supabase Runtime APIs.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

interface InviteStaffPayload {
  email?: string;
  displayName?: string;
  temporaryPassword?: string;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (request, ctx) => {
    try {
      const userId = ctx.userClaims?.sub;
      if (!userId) throw new Error("sign in required");

      const { data: profile, error: profileError } = await ctx.supabase
        .from("profiles")
        .select("business_id, role, active")
        .eq("id", userId)
        .single();

      if (profileError || !profile?.active || profile.role !== "owner") {
        throw new Error("owner access required");
      }

      const body = (await request.json()) as InviteStaffPayload;
      const email = body.email?.trim().toLowerCase();
      if (!email || !email.includes("@")) throw new Error("enter a valid email");
      if (!body.temporaryPassword || body.temporaryPassword.length < 8) {
        throw new Error("temporary password must be at least 8 characters");
      }

      const { data, error } = await ctx.supabaseAdmin.auth.admin.createUser({
        email,
        password: body.temporaryPassword,
        email_confirm: true,
        user_metadata: {
          business_id: profile.business_id,
          role: "staff",
          full_name: body.displayName?.trim() || email.split("@")[0],
          must_change_password: true,
        },
      });

      if (error) throw error;
      return Response.json({ id: data.user?.id, email });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "invite failed" },
        { status: 400 },
      );
    }
  }),
};
