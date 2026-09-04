import { Router, type Request, type Response, type NextFunction } from 'express';
import type {
  Repositories,
  DashboardOverviewData,
  RecentLeadStatus,
  Lead,
  Customer,
  Conversation,
  Message,
} from '@limax/shared';

function sanitizePhone(phone?: string): string {
  if (!phone) return 'Maxfiy';
  const clean = phone.replace(/\s+/g, '');
  if (clean.length >= 9) {
    const prefix = clean.slice(0, Math.min(6, clean.length - 4));
    const suffix = clean.slice(-2);
    return `${prefix} *** ** ${suffix}`;
  }
  return '*** *** **';
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  }
  return `${mins}m ${secs}s`;
}

function getTashkentNow(): Date {
  return new Date();
}

function getFilterDates(dateRange?: string): { start?: Date; end?: Date; prevStart?: Date; prevEnd?: Date } {
  const now = getTashkentNow();
  if (!dateRange || dateRange === 'all') {
    return {};
  }

  const end = now;
  let start: Date;

  if (dateRange === 'today') {
    // Asia/Tashkent (+05:00) 00:00:00
    const tashkentOffsetMs = 5 * 60 * 60 * 1000;
    const localMs = now.getTime() + tashkentOffsetMs;
    const localDate = new Date(localMs);
    const startOfDayLocalMs = Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate(), 0, 0, 0, 0);
    start = new Date(startOfDayLocalMs - tashkentOffsetMs);
  } else if (dateRange === '7d') {
    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (dateRange === '30d') {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else if (dateRange === 'month') {
    // Calendar month start in Asia/Tashkent (+05:00)
    const tashkentOffsetMs = 5 * 60 * 60 * 1000;
    const localMs = now.getTime() + tashkentOffsetMs;
    const localDate = new Date(localMs);
    const startOfMonthLocalMs = Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), 1, 0, 0, 0, 0);
    start = new Date(startOfMonthLocalMs - tashkentOffsetMs);
  } else {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const durationMs = Math.max(1, end.getTime() - start.getTime());
  const prevEnd = start;
  const prevStart = new Date(start.getTime() - durationMs);

  return { start, end, prevStart, prevEnd };
}

export function createDashboardRouter(repos: Repositories): Router {
  const router: Router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.redirect(307, '/api/v1/dashboard/overview');
  });

  // GET /api/v1/dashboard/overview
  router.get('/overview', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const managerId = req.query.managerId as string | undefined;
      const dateRange = (req.query.dateRange as string) || '30d';

      const [leads, customersRes, conversations] = await Promise.all([
        repos.leads.findAll({}),
        repos.customers.findAll({ page: 1, limit: 1000 }),
        repos.conversations.findAll({}),
      ]);

      const customers = customersRes.data;

      const customersMap = new Map<string, Customer>();
      for (const cust of customers) {
        customersMap.set(cust.id, cust);
      }

      const conversationsMap = new Map<string, Conversation>();
      for (const conv of conversations) {
        conversationsMap.set(conv.id, conv);
      }

      const { start, end, prevStart, prevEnd } = getFilterDates(dateRange);

      const filterLead = (lead: Lead, startDate?: Date, endDate?: Date) => {
        if (managerId && managerId !== 'all' && lead.assignedManagerId !== managerId) {
          return false;
        }
        const created = new Date(lead.createdAt);
        if (startDate && created < startDate) return false;
        if (endDate && created > endDate) return false;
        return true;
      };

      const currentLeads = leads.filter((l: Lead) => filterLead(l, start, end));
      const prevLeads = prevStart && prevEnd ? leads.filter((l: Lead) => {
        if (managerId && managerId !== 'all' && l.assignedManagerId !== managerId) {
          return false;
        }
        const created = new Date(l.createdAt);
        return created >= prevStart && created < start!;
      }) : [];

      // Fetch handoffs and messages efficiently for current + prev leads
      const targetConvIds = new Set<string>();
      for (const l of [...currentLeads, ...prevLeads]) {
        if (l.conversationId) targetConvIds.add(l.conversationId);
      }
      for (const conv of conversations) {
        const cDate = new Date(conv.createdAt);
        if ((!start || cDate >= start) && (!end || cDate <= end)) {
          targetConvIds.add(conv.id);
        }
      }

      const convHandoffsMap = new Map<string, boolean>();
      const convAiProcessedMap = new Map<string, boolean>();
      const convMessagesMap = new Map<string, Message[]>();

      await Promise.all(
        Array.from(targetConvIds).map(async (convId) => {
          const [handoffsList, messagesList, aiUsageLogs] = await Promise.all([
            repos.handoffs.findByConversationId(convId).catch(() => []),
            repos.messages.findByConversationId(convId).catch(() => []),
            repos.aiUsage.findByConversationId(convId).catch(() => []),
          ]);

          convMessagesMap.set(convId, messagesList);

          const convObj = conversationsMap.get(convId);
          const hasHandoff = handoffsList.length > 0;
          const isManagerStatus = convObj?.status === 'WAITING_MANAGER' || convObj?.status === 'MANAGER_ACTIVE';
          convHandoffsMap.set(convId, hasHandoff || isManagerStatus);

          const hasAiMsg = messagesList.some((m) => m.senderType === 'ai');
          const hasAiUsage = aiUsageLogs.length > 0;
          const isAiStatus = convObj?.status === 'AI_ACTIVE' && messagesList.length > 0;
          convAiProcessedMap.set(convId, hasAiMsg || hasAiUsage || isAiStatus);
        })
      );

      const isQualified = (l: Lead) => {
        return (
          (l.score ?? 0) >= 60 ||
          l.temperature === 'HOT' ||
          l.temperature === 'WARM' ||
          ['qualifying', 'proposal', 'negotiation', 'won'].includes(l.stage || '')
        );
      };

      const isUnqualified = (l: Lead) => {
        return l.stage === 'lost' || (l.temperature === 'COLD' && (l.score ?? 0) < 60);
      };

      const isUnknown = (l: Lead) => {
        return !isQualified(l) && !isUnqualified(l);
      };

      const isManagerRoutedLead = (l: Lead) => {
        const convId = l.conversationId;
        const handoffOrStatus = convId ? (convHandoffsMap.get(convId) ?? false) : false;
        return handoffOrStatus || Boolean(l.assignedManagerId);
      };

      const isAiProcessedLead = (l: Lead) => {
        if (isManagerRoutedLead(l)) return false; // Priority to manager routed for mutually exclusive donut
        const convId = l.conversationId;
        return convId ? (convAiProcessedMap.get(convId) ?? false) : false;
      };

      const calcStats = (list: Lead[]) => {
        const total = list.length;
        const qual = list.filter(isQualified).length;
        const unqual = list.filter(isUnqualified).length;
        const unkn = list.filter(isUnknown).length;
        const mgr = list.filter(isManagerRoutedLead).length;
        const ai = list.filter(isAiProcessedLead).length;
        return { total, qual, unqual, unkn, ai, mgr };
      };

      const currStats = calcStats(currentLeads);
      const prevStats = prevLeads.length > 0 ? calcStats(prevLeads) : null;

      const calcChange = (curr: number, prev: number | null) => {
        if (prev === null || prev === 0) return null;
        return Math.round(((curr - prev) / prev) * 100);
      };

      const leadSummary = {
        totalLeads: currStats.total,
        totalLeadsPrev: prevStats ? prevStats.total : null,
        totalLeadsChange: calcChange(currStats.total, prevStats ? prevStats.total : null),
        qualifiedLeads: currStats.qual,
        qualifiedLeadsPrev: prevStats ? prevStats.qual : null,
        qualifiedLeadsChange: calcChange(currStats.qual, prevStats ? prevStats.qual : null),
        unqualifiedLeads: currStats.unqual,
        unqualifiedLeadsPrev: prevStats ? prevStats.unqual : null,
        unqualifiedLeadsChange: calcChange(currStats.unqual, prevStats ? prevStats.unqual : null),
        unknownLeads: currStats.unkn,
        unknownLeadsPrev: prevStats ? prevStats.unkn : null,
        unknownLeadsChange: calcChange(currStats.unkn, prevStats ? prevStats.unkn : null),
        aiProcessedLeads: currStats.ai,
        aiProcessedLeadsPrev: prevStats ? prevStats.ai : null,
        aiProcessedLeadsChange: calcChange(currStats.ai, prevStats ? prevStats.ai : null),
        managerRoutedLeads: currStats.mgr,
        managerRoutedLeadsPrev: prevStats ? prevStats.mgr : null,
        managerRoutedLeadsChange: calcChange(currStats.mgr, prevStats ? prevStats.mgr : null),
      };

      const totalL = currStats.total || 1;
      const aiSummary = {
        aiProcessed: currStats.ai,
        managerRouted: currStats.mgr,
        totalLeads: currStats.total,
        aiPercent: currStats.total > 0 ? Math.round((currStats.ai / totalL) * 100) : 0,
        managerPercent: currStats.total > 0 ? Math.round((currStats.mgr / totalL) * 100) : 0,
      };

      // Top requested products from real leads (no fake fallback!)
      const productCounts = new Map<string, { name: string; count: number }>();
      for (const l of currentLeads) {
        if (l.productInterest && l.productInterest.trim() !== '') {
          const key = l.productInterest.trim();
          const existing = productCounts.get(key);
          if (existing) {
            existing.count += 1;
          } else {
            productCounts.set(key, { name: key, count: 1 });
          }
        }
      }

      const topProducts = Array.from(productCounts.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map((p, idx) => ({
          rank: idx + 1,
          name: p.name,
          count: p.count,
          percentage: currStats.total > 0 ? Math.round((p.count / currStats.total) * 100) : 0,
        }));

      // Top managers dynamically computed from real assignedManagerIds
      const managerStatsMap = new Map<string, { total: number; qual: number; won: number }>();
      for (const l of currentLeads) {
        if (l.assignedManagerId) {
          const mId = l.assignedManagerId;
          const stats = managerStatsMap.get(mId) || { total: 0, qual: 0, won: 0 };
          stats.total += 1;
          if (isQualified(l)) stats.qual += 1;
          if (l.stage === 'won' || l.stage === 'negotiation') stats.won += 1;
          managerStatsMap.set(mId, stats);
        }
      }

      const topManagers = Array.from(managerStatsMap.entries()).map(([id, stats]) => {
        const maskedId = id.length > 8 ? id.slice(0, 6) : id;
        const name = `Menejer #${maskedId}`;
        const tot = stats.total || 1;
        return {
          id,
          name,
          totalLeads: stats.total,
          qualifiedLeads: stats.qual,
          qualificationRate: stats.total > 0 ? Math.round((stats.qual / tot) * 100) : 0,
          meetingsOrOrders: stats.won,
          conversionRate: stats.total > 0 ? Math.round((stats.won / tot) * 100) : 0,
        };
      });

      // Recent leads
      const sortedLeads = [...currentLeads].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ).slice(0, 10);

      const recentLeadsPromises = sortedLeads.map(async (l: Lead) => {
        const cust = customersMap.get(l.customerId);
        const conv = l.conversationId ? conversationsMap.get(l.conversationId) : undefined;

        let status: RecentLeadStatus = 'NEW';
        if (l.stage === 'won') status = 'CONVERTED';
        else if (l.stage === 'lost') status = 'UNQUALIFIED';
        else if (conv?.status === 'WAITING_MANAGER') status = 'WAITING_MANAGER';
        else if (conv?.status === 'MANAGER_ACTIVE') status = 'CONTACTED';
        else if (isQualified(l)) status = 'QUALIFIED';
        else if (conv?.status === 'AI_ACTIVE') status = 'AI_PROCESSING';

        let phone: string | undefined;
        try {
          const userContacts = await repos.contacts.findByCustomerId(l.customerId);
          if (userContacts && userContacts.length > 0) {
            phone = userContacts[0].phone;
          }
        } catch {
          // ignore
        }

        const managerLabel = l.assignedManagerId
          ? `Menejer #${l.assignedManagerId.length > 8 ? l.assignedManagerId.slice(0, 6) : l.assignedManagerId}`
          : 'Biriktirilmagan';

        return {
          id: l.id,
          customerDisplayName: cust?.name || `Mijoz #${l.customerId.slice(0, 6)}`,
          sanitizedPhone: sanitizePhone(phone),
          requestedProduct: l.productInterest || 'Ko‘rsatilmagan',
          channel: conv?.channel || 'telegram',
          status,
          manager: managerLabel,
          createdAt: new Date(l.createdAt).toISOString(),
        };
      });

      const recentLeads = await Promise.all(recentLeadsPromises);

      // Customer summary & Scope consistency
      const filteredCustomerIds = new Set<string>();
      for (const l of currentLeads) {
        if (l.customerId) filteredCustomerIds.add(l.customerId);
      }
      const filteredConversations = conversations.filter((c) => {
        if (managerId && managerId !== 'all') {
          // Check if conversation lead belongs to managerId
          const convLead = currentLeads.find((l) => l.conversationId === c.id);
          if (!convLead) return false;
        }
        const cDate = new Date(c.createdAt);
        if (start && cDate < start) return false;
        if (end && cDate > end) return false;
        return true;
      });
      for (const c of filteredConversations) {
        if (c.customerId) filteredCustomerIds.add(c.customerId);
      }

      const totalCustomers = filteredCustomerIds.size;
      const activeCustomers = Array.from(filteredCustomerIds).filter((cId) => {
        const cust = customersMap.get(cId);
        return cust?.status === 'active';
      }).length;

      const customerConvCounts = new Map<string, number>();
      for (const c of filteredConversations) {
        customerConvCounts.set(c.customerId, (customerConvCounts.get(c.customerId) || 0) + 1);
      }
      const repeatInquiries = Array.from(customerConvCounts.values()).filter((cnt) => cnt > 1).length;

      const wonLeadsCount = currentLeads.filter((l: Lead) => l.stage === 'won').length;
      const conversionRate = currentLeads.length > 0 ? Math.round((wonLeadsCount / currentLeads.length) * 100) : null;

      const customerSummary = {
        totalCustomers,
        activeCustomers,
        repeatInquiries,
        conversionRate,
      };

      // Real Response Time calculation from customer -> first AI/manager reply
      const responseTimeDiffs: number[] = [];
      for (const conv of filteredConversations) {
        const msgs = convMessagesMap.get(conv.id) || (await repos.messages.findByConversationId(conv.id).catch(() => []));
        const sortedMsgs = [...msgs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        for (let i = 0; i < sortedMsgs.length; i++) {
          const m = sortedMsgs[i];
          if (m.senderType === 'customer') {
            const customerTime = new Date(m.createdAt).getTime();
            // Find first subsequent AI or manager reply
            const replyMsg = sortedMsgs.slice(i + 1).find((rm) => rm.senderType === 'ai' || rm.senderType === 'manager');
            if (replyMsg) {
              const replyTime = new Date(replyMsg.createdAt).getTime();
              const diffSec = Math.max(0, Math.floor((replyTime - customerTime) / 1000));
              responseTimeDiffs.push(diffSec);
              break; // One primary response pair per conversation session
            }
          }
        }
      }

      let avgResponseSeconds: number | null = null;
      let formatted: string | null = null;
      const sampleSize = responseTimeDiffs.length;

      if (sampleSize > 0) {
        const sumSec = responseTimeDiffs.reduce((a, b) => a + b, 0);
        avgResponseSeconds = Math.round(sumSec / sampleSize);
        formatted = formatSeconds(avgResponseSeconds);
      }

      const responseTime = {
        avgResponseSeconds,
        formatted,
        sampleSize,
      };

      // Samples, Offers, Meetings strictly from filtered scope
      const sampleCount = currentLeads.filter((l: Lead) =>
        l.nextAction?.toLowerCase().includes('sampl') || l.productInterest?.toLowerCase().includes('namuna')
      ).length;
      const offerCount = currentLeads.filter((l: Lead) =>
        l.stage === 'proposal' || (l.estimatedValue ?? 0) > 0
      ).length;
      const meetingCount = currentLeads.filter((l: Lead) =>
        l.stage === 'negotiation' || l.nextAction?.toLowerCase().includes('uchrash')
      ).length;

      const overviewData: DashboardOverviewData = {
        period: {
          startDate: start?.toISOString(),
          endDate: end?.toISOString(),
          range: dateRange,
        },
        leadSummary,
        aiSummary,
        topProducts,
        topManagers,
        recentLeads,
        customerSummary,
        responseTime,
        samples: { count: sampleCount },
        offers: { count: offerCount },
        meetings: { count: meetingCount },
        meta: null,
      };

      res.json({ data: overviewData });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
