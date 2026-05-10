import {
  Controller,
  Get,
  NotFoundException,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { CognitoJwtPayload } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Req() request: Request & { user: CognitoJwtPayload }) {
    const cognitoId = request.user.sub;
    const user = await this.prisma.user.findUnique({
      where: { cognitoId },
      include: { tenant: true, site: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }
}
