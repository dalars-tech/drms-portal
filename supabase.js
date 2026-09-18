const SUPABASE_URL = "https://bpedjgnixeccxchmykhr.supabase.co";
const SUPABASE_KEY = "sb_publishable_oESVmVNM5MrDSMqTiULYWQ_4Wzmd0YN";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 60 * 1000;
const LOGIN_ATTEMPTS_KEY = "drms-login-attempts";

function loginAttemptKey(email) {
    return String(email || "").trim().toLowerCase();
}

function readLoginAttempts() {
    try {
        return JSON.parse(localStorage.getItem(LOGIN_ATTEMPTS_KEY) || "{}");
    } catch {
        return {};
    }
}

function writeLoginAttempts(attempts) {
    try {
        localStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify(attempts));
    } catch {
        // Login still relies on Supabase Auth when storage is unavailable.
    }
}

function loginLockoutRemaining(email) {
    const attempts = readLoginAttempts()[loginAttemptKey(email)] || [];
    const now = Date.now();
    const recentAttempts = attempts.filter((timestamp) => now - timestamp < LOGIN_WINDOW_MS);
    const latestAttempt = recentAttempts[recentAttempts.length - LOGIN_LIMIT];

    if (latestAttempt && now - latestAttempt < LOGIN_LOCKOUT_MS) {
        return Math.ceil((LOGIN_LOCKOUT_MS - (now - latestAttempt)) / 1000);
    }

    return 0;
}

async function signInWithRateLimit(email, password) {
    const key = loginAttemptKey(email);
    const remaining = loginLockoutRemaining(key);

    if (remaining > 0) {
        return {
            data: null,
            error: { message: `Too many failed attempts. Try again in ${remaining} seconds.` },
            rateLimited: true
        };
    }

    const response = await supabaseClient.auth.signInWithPassword({ email, password });
    const attempts = readLoginAttempts();
    const now = Date.now();
    const recentAttempts = (attempts[key] || []).filter((timestamp) => now - timestamp < LOGIN_WINDOW_MS);

    if (response.error) {
        attempts[key] = [...recentAttempts, now].slice(-LOGIN_LIMIT);
    } else {
        delete attempts[key];
    }

    writeLoginAttempts(attempts);
    return { ...response, rateLimited: false };
}
