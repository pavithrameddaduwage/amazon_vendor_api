import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';

@Injectable()
export class DatabaseService implements OnModuleInit {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onModuleInit() {
    try {
      await this.connection.query('SELECT 1'); // Try a simple query to check the connection
      console.log('Database connected successfully');
    } catch (error) {
      console.error('Database connection error:', error);
      throw new Error('Database connection failed!');
    }
  }
}
