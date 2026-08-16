import { createAuthClient } from "better-auth/client"

/** No plugins: signIn.email, signUp.email, signIn.social, requestPasswordReset and resetPassword
 * are all core client methods. The emailOTP plugin was dropped when the OTP flow was replaced by
 * passwords and Google — adding a client plugin whose server counterpart is gone would only
 * expose endpoints that 404. */
export const authClient = createAuthClient()
