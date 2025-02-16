import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  providers: [AuthService],
  exports: [AuthService], // Export to be used in other services
})
export class AuthModule {}
