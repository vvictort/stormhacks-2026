// Sessions replace scheduled real-phone campaigns in the simulated-device game.
export interface GameSession {
  id: string;
  userId: string;
  status: 'active' | 'paused' | 'ended';
  activeAttemptId: string | null;
  nextArrivalAt: string | null;
}
