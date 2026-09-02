import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth";

export default async function SettingsPage() {
  const session = await requireSession();

  // Members cannot open the team page, so send them somewhere they can use.
  redirect(session.role === "owner" ? "/settings/team" : "/settings/inbox");
}
