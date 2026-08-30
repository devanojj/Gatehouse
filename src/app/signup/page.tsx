import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { Logo } from "@/app/ui/Logo";

import { SignupForm } from "./SignupForm";

export default async function SignupPage() {
  if (await getSession()) redirect("/tickets");

  return (
    <div className="auth">
      <div className="auth-box">
        <div className="auth-brand">
          <Logo size={26} />
        </div>

        <div className="auth-card">
          <SignupForm />
        </div>

        <p className="auth-alt">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
