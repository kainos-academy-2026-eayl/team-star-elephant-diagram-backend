import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

export async function loadSecrets(): Promise<void> {
    const vaultUrl = process.env.KEY_VAULT_URL;

    if (!vaultUrl) {
        throw new Error('KEY_VAULT_URL is required');
    }

    const credential = new DefaultAzureCredential();
    const client = new SecretClient(vaultUrl, credential);

    const secretMappings = [
        ['DATABASE_URL', 'database-url'],
        ['JWT_SECRET', 'jwt-secret'],
        ['ADMIN_ACCESS_TOKEN_SECRET', 'admin-access-token-secret'],
        ['ADMIN_REFRESH_TOKEN_SECRET', 'admin-refresh-token-secret'],
    ] as const;

    for (const [environmentVariable, secretName] of secretMappings) {
        const secret = await client.getSecret(secretName);

        if (!secret.value) {
            throw new Error(`Required Key Vault secret is empty: ${secretName}`);
        }

        process.env[environmentVariable] = secret.value;
    }
}