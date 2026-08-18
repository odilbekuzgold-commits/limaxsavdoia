import crypto from 'node:crypto';
import { REQUIRED_SPREADSHEET_ID } from './schemas.js';

export interface GoogleSheetsClientConfig {
  spreadsheetId: string;
  serviceAccountEmail?: string;
  privateKey?: string;
  mockData?: {
    Products?: string[][];
    Prices?: string[][];
    Inventory?: string[][];
    Sync_Control?: string[][];
  };
}

export class GoogleSheetsClient {
  private spreadsheetId: string;
  private serviceAccountEmail?: string;
  private privateKey?: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private mockData?: GoogleSheetsClientConfig['mockData'];

  constructor(config: GoogleSheetsClientConfig) {
    if (config.spreadsheetId !== REQUIRED_SPREADSHEET_ID) {
      throw new Error(`Invalid Spreadsheet ID: expected '${REQUIRED_SPREADSHEET_ID}', got '${config.spreadsheetId}'`);
    }
    this.spreadsheetId = config.spreadsheetId;
    this.serviceAccountEmail = config.serviceAccountEmail;
    this.privateKey = config.privateKey ? config.privateKey.replace(/\\n/g, '\n') : undefined;
    this.mockData = config.mockData;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    if (!this.serviceAccountEmail || !this.privateKey) {
      throw new Error('Google Sheets service account credentials (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY) are missing');
    }

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claimSet = {
      iss: this.serviceAccountEmail,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedClaim = Buffer.from(JSON.stringify(claimSet)).toString('base64url');
    const signatureInput = `${encodedHeader}.${encodedClaim}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signatureInput);
    signer.end();
    const signature = signer.sign(this.privateKey, 'base64url');
    const jwt = `${signatureInput}.${signature}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to obtain Google OAuth2 token: ${res.status} ${errText}`);
    }

    const tokenData = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = tokenData.access_token;
    this.tokenExpiresAt = Date.now() + tokenData.expires_in * 1000;
    return this.accessToken;
  }

  async readTab(tabName: 'Products' | 'Prices' | 'Inventory' | 'Sync_Control'): Promise<string[][]> {
    if (this.mockData && this.mockData[tabName]) {
      return this.mockData[tabName] || [];
    }

    const token = await this.getAccessToken();
    const encodedTab = encodeURIComponent(tabName);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodedTab}!A1:Z500`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Google Sheet tab '${tabName}' not found`);
      }
      const errText = await res.text();
      throw new Error(`Google Sheets API error for tab '${tabName}': ${res.status} ${errText}`);
    }

    const data = (await res.json()) as { values?: string[][] };
    return data.values || [];
  }

  getSpreadsheetId(): string {
    return this.spreadsheetId;
  }

  async fetchTabs(tabNames: ('Products' | 'Prices' | 'Inventory' | 'Sync_Control' | string)[]): Promise<Record<string, string[][]>> {
    const result: Record<string, string[][]> = {};
    for (const name of tabNames) {
      result[name] = await this.readTab(name as any);
    }
    return result;
  }

  async readAllTabs(): Promise<{
    products: string[][];
    prices: string[][];
    inventory: string[][];
    syncControl: string[][];
  }> {
    const [products, prices, inventory, syncControl] = await Promise.all([
      this.readTab('Products'),
      this.readTab('Prices'),
      this.readTab('Inventory'),
      this.readTab('Sync_Control'),
    ]);

    return { products, prices, inventory, syncControl };
  }
}
