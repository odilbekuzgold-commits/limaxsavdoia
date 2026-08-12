import { Router, type Request, type Response, type NextFunction } from 'express';
import type { IConversationRepository, IMessageRepository, IHandoffRepository } from '@limax/shared';
import { MockAIProvider } from '@limax/ai-engine';

export function createConversationsRouter(
  conversationRepo: IConversationRepository,
  messageRepo: IMessageRepository,
  handoffRepo: IHandoffRepository,
): Router {
  const router: Router = Router();
  const aiProvider = new MockAIProvider();

  // GET /api/v1/conversations
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.query.status as string | undefined;
      const all = await conversationRepo.findAll({ status });
      res.json({ data: all, meta: { total: all.length } });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/conversations/:id
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const conv = await conversationRepo.findById(req.params.id);
      if (!conv) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
        return;
      }
      const msgs = await messageRepo.findByConversationId(req.params.id);
      res.json({ data: { ...conv, messages: msgs } });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/conversations/:id/messages
  router.post('/:id/messages', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const conv = await conversationRepo.findById(req.params.id);
      if (!conv) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
        return;
      }

      const { content } = req.body;
      if (!content || typeof content !== 'string') {
        res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Content is required' } });
        return;
      }

      // 1. Add User Message
      const userMsg = await messageRepo.create({
        conversationId: conv.id,
        senderType: 'customer',
        content,
        contentType: 'text',
        status: 'RECEIVED',
      });

      // 2. Generate AI response if conversation is AI_ACTIVE
      let aiMsg = null;
      if (conv.status === 'AI_ACTIVE') {
        const currentMsgs = await messageRepo.findByConversationId(conv.id);
        const aiResponse = await aiProvider.generateResponse(content, {
          conversationHistory: currentMsgs.map((m) => ({
            role: m.senderType === 'customer' ? 'user' as const : 'assistant' as const,
            content: m.content,
          })),
        });

        if (aiResponse.suggestedAction === 'handoff') {
          await conversationRepo.update(conv.id, { status: 'WAITING_MANAGER' });
          await handoffRepo.create({
            conversationId: conv.id,
            customerId: conv.customerId,
            reason: aiResponse.handoffReason || 'AI_HANDOFF_TRIGGERED',
            priority: 'high',
          });
        }

        aiMsg = await messageRepo.create({
          conversationId: conv.id,
          senderType: 'ai',
          content: aiResponse.content,
          contentType: 'text',
          status: 'SENT',
        });
      }

      await conversationRepo.update(conv.id, { lastMessageAt: new Date() });
      const updatedConv = await conversationRepo.findById(conv.id);

      res.status(201).json({
        data: {
          userMessage: userMsg,
          aiMessage: aiMsg,
          conversationStatus: updatedConv?.status || conv.status,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/conversations/:id/handoff
  router.post('/:id/handoff', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const conv = await conversationRepo.findById(req.params.id);
      if (!conv) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
        return;
      }

      const { reason, managerId } = req.body;
      await conversationRepo.update(conv.id, { status: 'WAITING_MANAGER' });

      const handoff = await handoffRepo.create({
        conversationId: conv.id,
        customerId: conv.customerId,
        reason: reason || 'MANUAL_MANAGER_REQUEST',
        priority: 'high',
        assignedManagerId: managerId,
        assignedAt: managerId ? new Date() : undefined,
      });

      const updatedConv = await conversationRepo.findById(conv.id);
      res.json({ data: { conversation: updatedConv, handoff } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
