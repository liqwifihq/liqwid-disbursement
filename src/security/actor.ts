import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

export type AdminRole = 'maker' | 'approver' | 'admin';
export type RequestActor = { email: string; role: AdminRole };

export function requestActor(actorHeader?: string, roleHeader?: string): RequestActor {
  const email = String(actorHeader || '').trim().toLowerCase();
  const role = String(roleHeader || '').trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new UnauthorizedException('An authenticated operator identity is required.');
  }
  if (!['maker', 'approver', 'admin'].includes(role)) {
    throw new UnauthorizedException('A valid operator role is required.');
  }
  return { email, role: role as AdminRole };
}

export function requireRole(actor: RequestActor, allowed: AdminRole[]) {
  if (!allowed.includes(actor.role)) throw new ForbiddenException('Your role cannot perform this action.');
}
