import axiosInstance from '@/lib/axios';
import { CrawlResult } from '@/types/crawler';

export const crawlerApi = {
  startCrawl: async (websiteUrl: string): Promise<CrawlResult> => {
    try {
      const { data } = await axiosInstance.post('/crawler/start', { 
        websiteUrl,
        options: {
          maxPages: 100,
          timeout: 30000,
          followRedirects: true
        }
      });
      return data;
    } catch (error: any) {
      // Enhanced error handling
      const message = error.response?.data?.message || 
                     error.message || 
                     'Failed to start crawl';
      throw new Error(message);
    }
  },

  getCrawlStatus: async (crawlId: string): Promise<CrawlResult> => {
    const { data } = await axiosInstance.get(`/crawler/status/${crawlId}`);
    return data;
  },

  getCrawlHistory: async (): Promise<CrawlResult[]> => {
    const { data } = await axiosInstance.get('/crawler/history');
    return data;
  },

  stopCrawl: async (crawlId: string): Promise<void> => {
    await axiosInstance.post(`/crawler/stop/${crawlId}`);
  }
};
