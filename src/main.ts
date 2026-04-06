import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from 'dotenv';

config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  await app.listen(4016);
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 14);
  startDate.setHours(0, 0, 0, 0);

  console.log('Application is running on port 4016');
  console.log(`Fetching sales data from ${startDate.toISOString()} to ${endDate.toISOString()}`);

}

bootstrap();
