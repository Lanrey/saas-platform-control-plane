import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import type { AppConfig } from '../config/app.config';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),

    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const appConf = configService.get<AppConfig>('app')!;

        let privateKey: string;
        if (appConf.jwt.privateKeyBase64) {
          privateKey = Buffer.from(appConf.jwt.privateKeyBase64, 'base64').toString('utf-8');
        } else if (appConf.jwt.privateKeyPath) {
          privateKey = readFileSync(appConf.jwt.privateKeyPath, 'utf-8');
        } else if (process.env.NODE_ENV !== 'production') {
          // Development fallback
          privateKey = DEV_PRIVATE_KEY;
        } else {
          throw new Error(
            'JWT private key not configured. Set JWT_PRIVATE_KEY_BASE64 or JWT_PRIVATE_KEY_PATH.',
          );
        }

        return {
          privateKey,
          signOptions: {
            algorithm: 'RS256',
            expiresIn: appConf.jwt.expiresIn,
            issuer: appConf.jwt.issuer,
            audience: appConf.jwt.audience,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}

// Development-only ephemeral RSA private key (DO NOT USE IN PRODUCTION)
const DEV_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
PLEASE_REPLACE_WITH_REAL_PRIVATE_KEY_FOR_PRODUCTION
Set JWT_PRIVATE_KEY_BASE64 or JWT_PRIVATE_KEY_PATH environment variable.
-----END RSA PRIVATE KEY-----`;
