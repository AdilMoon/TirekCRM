CREATE TABLE "PasswordReset" (
 "userId" UUID NOT NULL,
 "tokenHash" VARCHAR(64) NOT NULL,
 "credentialHash" VARCHAR(64) NOT NULL,
 "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("userId"),
 CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "PasswordReset_token_hash_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
 CONSTRAINT "PasswordReset_credential_hash_check" CHECK ("credentialHash" ~ '^[a-f0-9]{64}$'),
 CONSTRAINT "PasswordReset_expiry_check" CHECK ("expiresAt" > "requestedAt")
);
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");
CREATE INDEX "PasswordReset_expiresAt_idx" ON "PasswordReset"("expiresAt");
