import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { Logo } from "@/app/ui/Logo";

import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  if (await getSession()) redirect("/tickets");

  const { expired } = await searchParams;

  return (
    <div className="auth">
      <div className="auth-box">
        <div className="auth-brand">
          <Logo size={26} />
        </div>

        <div className="auth-card">
          {expired ? (
            <p className="notice notice-info" role="status">
              That sign-in link has expired or was already used. Request a fresh
              one below.
            </p>
          ) : null}

          <LoginForm />
        </div>

        <p className="auth-alt">
          New organization? <Link href="/signup">Create a workspace</Link>
        </p>
      </div>
    </div>
  );
}
