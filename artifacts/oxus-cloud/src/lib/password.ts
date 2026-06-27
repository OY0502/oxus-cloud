export const PASSWORD_MIN_LENGTH = 10;

export interface PasswordRule {
  id: string;
  label: string;
  test: (password: string) => boolean;
}

export const passwordRules: PasswordRule[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (p) => p.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "lowercase",
    label: "One lowercase letter",
    test: (p) => /[a-z]/.test(p),
  },
  {
    id: "uppercase",
    label: "One uppercase letter",
    test: (p) => /[A-Z]/.test(p),
  },
  { id: "number", label: "One number", test: (p) => /[0-9]/.test(p) },
  {
    id: "symbol",
    label: "One symbol (!@#$…)",
    test: (p) => /[^A-Za-z0-9]/.test(p),
  },
];

export function getFailedPasswordRules(password: string): PasswordRule[] {
  return passwordRules.filter((rule) => !rule.test(password));
}

export function isPasswordValid(password: string): boolean {
  return getFailedPasswordRules(password).length === 0;
}

export type PasswordStrength = "weak" | "fair" | "good" | "strong";

export function getPasswordStrength(password: string): {
  score: number;
  label: PasswordStrength;
} {
  if (!password) return { score: 0, label: "weak" };
  const passed = passwordRules.filter((rule) => rule.test(password)).length;
  const score = Math.round((passed / passwordRules.length) * 100);
  let label: PasswordStrength = "weak";
  if (passed >= passwordRules.length) label = "strong";
  else if (passed >= 4) label = "good";
  else if (passed >= 3) label = "fair";
  return { score, label };
}
