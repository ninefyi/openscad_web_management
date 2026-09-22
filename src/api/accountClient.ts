import type { Configuration } from "../types/template";

export interface Account {
  id: string;
  name: string;
  email: string;
}

export interface SavedDesign {
  id: string;
  templateId: string;
  name: string | null;
  configuration: Configuration;
  createdAt: string;
  updatedAt: string;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Request failed");
  return body;
}

export async function signup(name: string, email: string, password: string): Promise<Account> {
  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  return parseJsonOrThrow<Account>(res);
}

export async function login(email: string, password: string): Promise<Account> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return parseJsonOrThrow<Account>(res);
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

/** Returns null (rather than throwing) on 401 — "not signed in" is a normal
 * state to check for on load, not an error. */
export async function getCurrentAccount(): Promise<Account | null> {
  const res = await fetch("/api/account/me");
  if (res.status === 401) return null;
  return parseJsonOrThrow<Account>(res);
}

export async function listSavedDesigns(): Promise<SavedDesign[]> {
  const res = await fetch("/api/account/designs");
  return parseJsonOrThrow<SavedDesign[]>(res);
}

export async function getSavedDesign(id: string): Promise<SavedDesign> {
  const res = await fetch(`/api/account/designs/${id}`);
  return parseJsonOrThrow<SavedDesign>(res);
}

export async function saveDesign(
  templateId: string,
  configuration: Configuration,
  name?: string,
): Promise<SavedDesign> {
  const res = await fetch("/api/account/designs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateId, configuration, name }),
  });
  return parseJsonOrThrow<SavedDesign>(res);
}

export async function updateSavedDesign(
  id: string,
  configuration: Configuration,
  name?: string,
): Promise<SavedDesign> {
  const res = await fetch(`/api/account/designs/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ configuration, name }),
  });
  return parseJsonOrThrow<SavedDesign>(res);
}

export async function deleteSavedDesign(id: string): Promise<void> {
  const res = await fetch(`/api/account/designs/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Couldn't delete this design.");
}
