import Link from "next/link";
import { redirect } from "next/navigation";

import { completeSignIn } from "@/app/actions/auth";
import { findUsableMagicLink, getSession } from "@/lib/auth";
import { Logo } from "@/app/ui/Logo";

/**
 * Magic links land here. The token is checked on render, but it is only
 * *consumed* by the POST behind the button: a session cookie cannot be set
 * while a Server Component renders, and the extra click keeps link-scanning
 * email clients from spending a single-use token before the recipient clicks.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (await getSession()) redirect("/tickets");

  const { token } = await searchParams;
  const link = token ? await findUsableMagicLink(token) : null;

  return (
    <div className="auth">
      <div className="auth-box">
        <div className="auth-brand">
          <Logo size={26} />
        </div>

        <div className="auth-card">
          {link ? (
            <>
              <h1>You&rsquo;re verified</h1>
              <p className="auth-lede">
                Continue to open your session on this device.
              </p>
              <form action={completeSignIn}>
                <input type="hidden" name="token" value={token} />
                <button className="btn btn-primary" type="submit">
                  Continue to Gatehouse
                </button>
              </form>
            </>
          ) : (
            <>
              <h1>This link doesn&rsquo;t work</h1>
              <p className="auth-lede">
                Sign-in links expire after 30 minutes and can only be used once.
              </p>
              <Link className="btn btn-primary" href="/login">
                Request a new link
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
