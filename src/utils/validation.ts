/**
 * Form and error message validation helpers for human-readable errors across SkipTray.
 */

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (!password) {
    return { valid: false, error: 'Password is required.' };
  }
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long.' };
  }
  return { valid: true };
}

export function validateRegistration(data: {
  email: string;
  name: string;
  idNumber: string;
  password: string;
  confirmPassword: string;
}): { [key: string]: string } {
  const errors: { [key: string]: string } = {};

  if (!data.email?.trim()) {
    errors.email = 'Please enter your email address.';
  } else if (!isValidEmail(data.email)) {
    errors.email = 'Please enter a valid email address (e.g., student@university.edu).';
  }

  if (!data.name?.trim()) {
    errors.name = 'Please enter your full name.';
  } else if (data.name.trim().length < 2) {
    errors.name = 'Full name must be at least 2 characters.';
  }

  if (!data.idNumber?.trim()) {
    errors.idNumber = 'Please enter your student or employee ID number.';
  }

  if (!data.password) {
    errors.password = 'Please create a password.';
  } else if (data.password.length < 8) {
    errors.password = 'Password must be at least 8 characters long.';
  }

  if (!data.confirmPassword) {
    errors.confirmPassword = 'Please confirm your password.';
  } else if (data.password !== data.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match. Please re-enter them.';
  }

  return errors;
}

export function formatErrorMessage(err: unknown, fallbackMessage = 'An unexpected error occurred. Please try again.'): string {
  if (!err) return fallbackMessage;

  let msg = '';
  if (typeof err === 'string') {
    msg = err;
  } else if (err instanceof Error) {
    msg = err.message;
  } else if (typeof err === 'object' && err !== null && 'message' in err) {
    msg = String((err as any).message);
  } else if (typeof err === 'object' && err !== null && 'error_description' in err) {
    msg = String((err as any).error_description);
  } else {
    msg = JSON.stringify(err);
  }

  if (!msg || msg === '{}' || msg.trim() === '') {
    return fallbackMessage;
  }

  const lower = msg.toLowerCase();

  // Common authentication & Supabase error patterns
  if (lower.includes('invalid login credentials') || lower.includes('invalid_grant')) {
    return 'Invalid email or password. Please verify your credentials and try again.';
  }
  if (lower.includes('user already registered') || lower.includes('already exists')) {
    return 'An account with this email address already exists. Please sign in instead.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Your email address has not been verified. Please check your inbox for the confirmation link.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (lower.includes('networkerror') || lower.includes('failed to fetch')) {
    return 'Network connection issue. Please check your internet connection and try again.';
  }
  if (lower.includes('jwt expired') || lower.includes('session expired')) {
    return 'Your session has expired. Please log in again to continue.';
  }
  if (lower.includes('permission denied') || lower.includes('new row violates row-level security')) {
    return 'Access denied. You do not have permission to perform this action.';
  }

  return msg;
}
