// Setup type definitions for built-in Supabase Runtime APIs.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

interface TeamAccountPayload {
  action?: "create" | "update-role";
  email?: string;
  displayName?: string;
  temporaryPassword?: string;
  role?: "owner" | "staff";
  userId?: string;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (request, ctx) => {
    try {
      const userId = ctx.userClaims?.id || ctx.jwtClaims?.sub;
      if (!userId) throw new Error("sign in required");

      const { data: profile, error: profileError } = await ctx.supabase
        .from("profiles")
        .select("business_id, role, active")
        .eq("id", userId)
        .single();

      if (profileError || !profile?.active || profile.role !== "owner") {
        throw new Error("owner access required");
      }

      const body = (await request.json()) as TeamAccountPayload;
      const role = body.role === "owner" ? "owner" : "staff";

      if (body.action === "update-role") {
        if (!body.userId) throw new Error("account is required");
        if (body.userId === userId) throw new Error("you cannot change your own owner role");

        const { data: target, error: targetError } = await ctx.supabaseAdmin
          .from("profiles")
          .select("id, business_id")
          .eq("id", body.userId)
          .single();
        if (targetError || !target || target.business_id !== profile.business_id) {
          throw new Error("account not found");
        }

        const { error: updateError } = await ctx.supabaseAdmin
          .from("profiles")
          .update({ role })
          .eq("id", body.userId);
        if (updateError) throw updateError;
        await ctx.supabaseAdmin.auth.admin.updateUserById(body.userId, { user_metadata: { role } });
        return Response.json({ id: body.userId, role });
      }

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
          role,
          full_name: body.displayName?.trim() || email.split("@")[0],
          must_change_password: true,
        },
      });

      if (error) throw error;
      return Response.json({ id: data.user?.id, email, role });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "invite failed" },
        { status: 400 },
      );
    }
  }),
};
