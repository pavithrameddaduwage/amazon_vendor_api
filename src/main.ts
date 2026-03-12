import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from 'dotenv';

config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  await app.listen(3000);
  console.log('Application is running on port 3000');
  console.log('Endpoints:');
  console.log('  GET /sales/fetch?startDate=<ISO>&endDate=<ISO>');
  console.log('  GET /inventory/fetch?startDate=<ISO>&endDate=<ISO>');
}

bootstrap();
