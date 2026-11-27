# Google and Facebook sign-in setup

Social sign-in uses server-side OAuth callbacks. Keep provider secrets in the
local `.env` file or your deployment's secret manager; never put them in
frontend code or commit them.

## Local callback URLs

Register these exact URLs in each provider's OAuth app:

- Google: `http://localhost:3000/auth/google/callback`
- Facebook: `http://localhost:3000/auth/facebook/callback`

For production, register the matching HTTPS URLs on your deployed domain and
set the callback variables to those exact URLs.

## Environment variables

Set the following values in `.env`:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_CALLBACK_URL=http://localhost:3000/auth/facebook/callback
FACEBOOK_GRAPH_VERSION=v24.0
```

Create a Google OAuth client for a web application and enable the OpenID
Connect `openid`, `email`, and `profile` scopes. Create a Facebook Login app
and enable the `email` and `public_profile` permissions.

Run `npx prisma migrate deploy` to create the social-account table and
`npx prisma generate` to regenerate the ignored Prisma Client, then start the
app with `npm start`. The first social sign-in creates a member account;
subsequent sign-ins use the provider account ID. An existing email/password
account is not silently linked to a social account.
