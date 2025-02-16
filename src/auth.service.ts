import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AuthService {
  private readonly tokenUrl = 'https://api.amazon.com/auth/o2/token';

  constructor(private readonly httpService: HttpService) {}

  async getAccessToken(): Promise<{ access_token: string; expirationTime: number }> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(this.tokenUrl, {
          grant_type: 'refresh_token',
          refresh_token: process.env.REFRESH_TOKEN,
          client_id: process.env.CLIENT_ID,
          client_secret: process.env.CLIENT_SECRET,
        }),
      );

      if (!response.data.access_token || !response.data.expires_in) {
        throw new Error('Missing access token or expiration time in the response.');
      }

      const expirationTime = new Date().getTime() + response.data.expires_in * 1000;
      console.log('New Access Token:', response.data.access_token); // Log the token for debugging
      return { access_token: response.data.access_token, expirationTime };
    } catch (error) {
      console.error('Error fetching access token:', error.response ? error.response.data : error.message);
      throw new Error('Unable to fetch access token.');
    }
  }
}
