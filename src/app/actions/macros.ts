"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import {
  createMacro,
  deleteMacro,
  getMacro,
  MACRO_BODY_MAX,
  MACRO_NAME_MAX,
  updateMacro,
} from "@/lib/macros";

export type MacroFormState = {
  error?: string;
  saved?: string;
};

/**
 * Macros are the team's own words, so any agent may write them — the same call
 * that is made for checking the mail. They are still tenant-owned: every id is
 * resolved against the session's organization before it is written to.
 */
function readFields(formData: FormData): { name: string; body: string } {
  return {
    name: String(formData.get("name") ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MACRO_NAME_MAX),
    body: String(formData.get("body") ?? "")
      .trim()
      .slice(0, MACRO_BODY_MAX),
  };
}

function readMacroId(formData: FormData): number {
  const macroId = Number(formData.get("macroId"));
  if (!Number.isInteger(macroId) || macroId <= 0) {
    throw new Error("Invalid macro.");
  }
  return macroId;
}

export async function createMacroAction(
  _prev: MacroFormState | undefined,
  formData: FormData,
): Promise<MacroFormState> {
  const session = await requireSession();
  const { name, body } = readFields(formData);

  if (!name) return { error: "Give the macro a name." };
  if (!body) return { error: "A macro needs something to say." };

  await createMacro(session.orgId, name, body);

  revalidatePath("/settings/macros");
  return { saved: `Created ${name}.` };
}

export async function updateMacroAction(
  _prev: MacroFormState | undefined,
  formData: FormData,
): Promise<MacroFormState> {
  const session = await requireSession();
  const macroId = readMacroId(formData);

  const macro = await getMacro(session.orgId, macroId);
  if (!macro) return { error: "That macro no longer exists." };

  const { name, body } = readFields(formData);
  if (!name) return { error: "Give the macro a name." };
  if (!body) return { error: "A macro needs something to say." };

  await updateMacro(session.orgId, macro.id, name, body);

  revalidatePath("/settings/macros");
  return { saved: `Saved ${name}.` };
}

export async function deleteMacroAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const macroId = readMacroId(formData);

  const macro = await getMacro(session.orgId, macroId);
  if (!macro) throw new Error("Macro not found.");

  await deleteMacro(session.orgId, macro.id);

  revalidatePath("/settings/macros");
}
