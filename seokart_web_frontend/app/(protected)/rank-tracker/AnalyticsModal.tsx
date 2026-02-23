"use client";

import React from "react";
import {
  X,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

import { KeywordAnalysisData } from "@/types/rankTracker";
import Link from "next/link";

interface AnalyticsModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  keyword?: string;
  analysisData?: KeywordAnalysisData | null;
  loading?: boolean;
  onRetry?: () => void;
}

function AnalyticsModal({
  isOpen = false,
  onClose,
  keyword = "",
  analysisData = null,
  loading = false,
  onRetry,
}: AnalyticsModalProps) {
  const chartData = React.useMemo(() => {
    if (!analysisData?.myRankingHistory) return [];

    const dates = Object.keys(analysisData.myRankingHistory).sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime()
    );

    return dates.map((date) => {
      const myPosition = analysisData.myRankingHistory[date];
      const dataPoint: any = {
        date,
        myRank: myPosition === 101 ? 100 : myPosition,
        actualMyRank: myPosition,
      };

      analysisData.competitors.forEach((competitor, index) => {
        if (competitor.rankingHistory?.[date]) {
          const compPos = competitor.rankingHistory[date];
          dataPoint[`comp${index + 1}`] = compPos === 101 ? 100 : compPos;
          dataPoint[`actualComp${index + 1}`] = compPos;
        }
      });

      return dataPoint;
    });
  }, [analysisData]);

  const getTrendIcon = (trend: string, change: number | null) => {
    if (change === null || change === 0)
      return <Minus size={16} className="text-gray-400" />;
    if (change > 0) return <TrendingUp size={16} className="text-green-500" />;
    return <TrendingDown size={16} className="text-red-500" />;
  };

  const formatPosition = (position: number | null) => {
    if (position === null || position === 101) return ">100";
    return position.toString();
  };

  const getPositionColor = (position: number | null) => {
    if (position === null || position === 101) return "text-red-600";
    if (position <= 3) return "text-green-600";
    if (position <= 10) return "text-yellow-600";
    return "text-orange-600";
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border rounded shadow-lg">
          <p className="text-sm font-semibold mb-2">{`Date: ${label}`}</p>
          {payload.map((entry: any, index: number) => {
            const actualKey = entry.dataKey.replace(/comp\d+|myRank/, (match:string) =>
              match === "myRank" ? "actualMyRank" : `actual${match.charAt(0).toUpperCase() + match.slice(1)}`
            );
            const actualValue = entry.payload[actualKey];
            return (
              <p key={index} className="text-sm" style={{ color: entry.color }}>
                {`${entry.name}: ${actualValue === 101 ? ">100" : `#${actualValue}`}`}
              </p>
            );
          })}
        </div>
      );
    }
    return null;
  };

  const competitorColors = ["#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-[#000000ba] flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-[80vw] mx-auto h-[90vh] flex flex-col overflow-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">
            {keyword ? `Ranking Details for "${keyword}"` : "Ranking Details"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center space-x-2">
              <Loader2 className="animate-spin" size={24} />
              <span>Loading keyword analysis...</span>
            </div>
          </div>
        )}

        {!loading && !analysisData && (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <p className="text-red-600 mb-4">
                Failed to load keyword analysis
              </p>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2 mx-auto"
                >
                  <RefreshCw size={16} />
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        {!loading && analysisData && (
          <div className="p-6 flex-1">
            <div className="keyword-detailsModal">
              <div className="grid grid-cols-2 gap-5">
                <div className="flex flex-col gap-5">
                  <div className="custom-table">
                    <table className="table">
                      <thead>
                        <tr>
                          <th
                            colSpan={3}
                            className="!text-left text-[13px] rounded-t-[10px]"
                          >
                            Comparison to {analysisData.comparison.current.month}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Current Ranking:</td>
                          <td className={getPositionColor(analysisData.comparison.current.position)}>
                            {formatPosition(analysisData.comparison.current.position)}
                          </td>
                          <td>{analysisData.comparison.current.month}</td>
                        </tr>

                        <tr>
                          <td>Comparison:</td>
                          <td className={getPositionColor(analysisData.comparison.previous.position || analysisData.comparison.current.position)}>
                            {formatPosition(analysisData.comparison.previous.position || analysisData.comparison.current.position)}
                          </td>
                          <td>{analysisData.comparison.previous.month || analysisData.comparison.current.month}</td>
                        </tr>

                        {analysisData.comparison.change !== null && (
                          <tr>
                            <td>Change:</td>
                            <td colSpan={2}>
                              <div className="flex items-center gap-2">
                                {getTrendIcon(analysisData.comparison.trend, analysisData.comparison.change)}
                                <span className={analysisData.comparison.change > 0 ? "text-green-600" : analysisData.comparison.change < 0 ? "text-red-600" : "text-gray-600"}>
                                  {Math.abs(analysisData.comparison.change)} positions
                                </span>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="custom-table">
                    <table className="table">
                      <thead>
                        <tr>
                          <th
                            colSpan={3}
                            className="!text-left text-[13px] rounded-t-[10px]"
                          >
                            Best & Worst Rankings
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Best Position:</td>
                          <td className="text-green-600 font-semibold">
                            {formatPosition(analysisData.extremePositions.best)}
                          </td>
                          <td>
                            {Object.entries(analysisData.myRankingHistory).find(
                              ([, pos]) => pos === analysisData.extremePositions.best
                            )?.[0] || "N/A"}
                          </td>
                        </tr>

                        <tr>
                          <td>Worst Position:</td>
                          <td className="text-red-600 font-semibold">
                            {formatPosition(analysisData.extremePositions.worst)}
                          </td>
                          <td>
                            {Object.entries(analysisData.myRankingHistory).find(
                              ([, pos]) => pos === analysisData.extremePositions.worst
                            )?.[0] || "N/A"}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="chartArea">
                  <div className="bg-gradient-to-b from-blue-50 to-white rounded-lg px-4 pt-2 pb-10 h-[240px] border border-[#e5e7eb]">
                    <h3 className="text-sm font-medium text-gray-700 mb-4">
                      Ranking Comparison
                    </h3>
                    {chartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis
                            dataKey="date"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fill: "#6B7280" }}
                          />
                          <YAxis
                            domain={[0, 100]}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fill: "#6B7280" }}
                            reversed
                            label={{
                              value: "Position",
                              angle: -90,
                              position: "insideLeft",
                              style: { fontSize: 11, fill: "#6B7280" },
                            }}
                          />
                          <Tooltip content={CustomTooltip} />
                          <Legend
                            wrapperStyle={{ fontSize: "12px" }}
                            iconType="line"
                          />

                          <Line
                            type="monotone"
                            dataKey="myRank"
                            stroke="#06B6D4"
                            strokeWidth={3}
                            name="My Ranking"
                            dot={{ fill: "#06B6D4", strokeWidth: 2, r: 4 }}
                            activeDot={{ r: 6, fill: "#0284C7" }}
                          />

                          {analysisData.competitors.slice(0, 4).map((competitor, index) => (
                            <Line
                              key={competitor.domain}
                              type="monotone"
                              dataKey={`comp${index + 1}`}
                              stroke={competitorColors[index]}
                              strokeWidth={2}
                              name={competitor.name}
                              dot={{ fill: competitorColors[index], strokeWidth: 2, r: 3 }}
                              activeDot={{ r: 5 }}
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-full">
                        <p className="text-gray-500 text-sm">No ranking data available</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-5">
                <div className="custom-table addedKeyword-table noDataTable">
                  <p className="py-2.5 px-2 text-[13px] font-semibold">
                    Your Website ranking and your competitors websites ranking on
                    Google for this keyword
                  </p>
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="text-[13px] !text-left">Position</th>
                        <th className="text-[13px] !text-left">
                          Ranked page and snippet
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const allRankings = [
                          {
                            position: analysisData.comparison.current.position,
                            domain: analysisData.activeDomain,
                            name: analysisData.activeDomain,
                            url: analysisData.comparison.current.url,
                            title: analysisData.comparison.current.title,
                            isOwn: true,
                          },
                          ...analysisData.competitors.map((comp) => ({
                            position: comp.currentPosition,
                            domain: comp.domain,
                            name: comp.name,
                            url: comp.url,
                            title: comp.title,
                            isOwn: false,
                          })),
                        ]
                          .filter((item) => item.position !== null && item.position <= 100)
                          .sort((a, b) => (a.position || 0) - (b.position || 0));

                        if (allRankings.length === 0) {
                          return (
                            <tr>
                              <td colSpan={2} className="text-center text-gray-500">
                                No ranking data available
                              </td>
                            </tr>
                          );
                        }

                        return allRankings.map((item, index) => (
                          <tr key={index} className={item.isOwn ? "bg-blue-50" : ""}>
                            <td>
                              <span
                                className={`inline-block px-[11px] py-1 rounded-full ${
                                  (item.position || 0) <= 3
                                    ? "bg-[#cdfee1] text-[#014b40]"
                                    : (item.position || 0) <= 10
                                    ? "bg-[#fef3c7] text-[#78350f]"
                                    : "bg-[#fed1d7] text-[#8e0b21]"
                                } text-[13px]`}
                              >
                                {item.position}
                              </span>
                            </td>
                            <td className="!text-left">
                              <div className="keyword-rankSnippet">
                                <p className="text-[#1a0dab] text-lg">
                                  {item.title || item.name}
                                  {item.isOwn && " (You)"}
                                </p>
                                {item.url ? (
                                  <>
                                    <Link
                                      href={item.url}
                                      target="_blank"
                                      className="text-[#006621] text-sm"
                                    >
                                      {item.url}
                                    </Link>
                                    <p className="text-[#545454]">
                                      {item.title && item.title.length > 50
                                        ? `${item.title.substring(0, 50)}...`
                                        : item.title || `Content from ${item.domain}`}
                                    </p>
                                  </>
                                ) : (
                                  <p className="text-gray-500 text-sm">
                                    {item.domain}
                                  </p>
                                )}
                              </div>
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AnalyticsModal;