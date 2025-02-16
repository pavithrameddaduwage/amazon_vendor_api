import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

export async function getAccessToken(): Promise<string> {
  try {
    const response = await axios.post(
      'https://api.amazon.com/auth/o2/token',
      {
        grant_type: 'refresh_token',
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        refresh_token: process.env.REFRESH_TOKEN,
      },
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );

    if (!response.data.access_token) {
      throw new Error('Failed to fetch access token.');
    }

    return response.data.access_token;
  } catch (error) {
    console.error('Error fetching access token:', error.message);
    throw error;
  }
}
