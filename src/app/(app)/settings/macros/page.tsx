import { deleteMacroAction } from "@/app/actions/macros";
import { requireSession } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { listMacros, MACRO_PLACEHOLDERS } from "@/lib/macros";

import { MacroForm } from "./MacroForm";

export default async function MacrosPage() {
  // Any agent may write macros: they are the team's own words, not
  // administration. They belong to the organization, never to one person.
  const session = await requireSession();
  const macros = await listMacros(session.orgId);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Macros</h1>
          <p>
            Saved replies for {session.orgName}. Pick one from the composer on a
            ticket and it drops into your draft — you can still edit it before
            sending.
          </p>
        </div>
      </div>

      <div className="card card-pad">
        <div className="section-title">Write a macro</div>
        <MacroForm />
        <p className="hint">
          These placeholders are filled in when the macro is inserted. Anything
          else in double braces is left exactly as you typed it.
        </p>
        <div className="placeholder-list">
          {MACRO_PLACEHOLDERS.map((placeholder) => (
            <code key={placeholder}>{`{{${placeholder}}}`}</code>
          ))}
        </div>
      </div>

      {macros.length === 0 ? (
        <div className="card">
          <p className="empty">
            No macros yet. The first one is usually the reply you type most.
          </p>
        </div>
      ) : null}

      {macros.map((macro) => (
        <div className="card card-pad" key={macro.id}>
          <div className="section-title">
            {macro.name}
            <span className="tab-count">
              updated {formatDate(macro.updated_at)}
            </span>
          </div>

          <MacroForm
            macro={{ id: macro.id, name: macro.name, body: macro.body }}
          />

          <div className="form-actions">
            <form action={deleteMacroAction}>
              <input type="hidden" name="macroId" value={macro.id} />
              <button className="btn btn-danger" type="submit">
                Delete macro
              </button>
            </form>
          </div>
        </div>
      ))}
    </>
  );
}
