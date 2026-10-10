// lib/auth.js
// NextAuth (v4) config: Google login + the permissions needed to read Drive and edit Sheets.
import GoogleProvider from "next-auth/providers/google";

const SCOPES = [
  "openid",
  "email",
  "profile",
  // lets the app SEARCH Drive for the file named "BookTracker_Data" (metadata only, no file contents)
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  // lets the app read and write the spreadsheet rows
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");

// Google access tokens last ~1 hour. Use the refresh token to get a new one.
async function refreshAccessToken(token) {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw data;
    return {
      ...token,
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      refreshToken: data.refresh_token ?? token.refreshToken,
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" }; // the API route will answer 401
  }
}

export const authOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        // access_type=offline + prompt=consent => Google returns a refresh token
        params: { scope: SCOPES, access_type: "offline", prompt: "consent" },
      },
    }),
  ],
  callbacks: {
    // Runs on every request that reads the session cookie.
    async jwt({ token, account }) {
      // First sign-in: keep Google's tokens inside the encrypted cookie (never sent to the browser JS).
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at * 1000,
        };
      }
      // Still valid (with a 60s safety margin)
      if (Date.now() < (token.expiresAt ?? 0) - 60_000) return token;
      // Expired: refresh
      return token.refreshToken ? refreshAccessToken(token) : { ...token, error: "NoRefreshToken" };
    },
  },
};
