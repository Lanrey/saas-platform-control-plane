import { Module } from '@nestjs/common';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],  // re-use JwtModule from AuthModule
  controllers: [OAuthController],
  providers: [OAuthService],
  exports: [OAuthService],
})
export class OAuthModule {}
