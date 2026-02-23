"use client";

import React, { useState } from "react";
import { Trash2, Monitor, Smartphone, Tablet, Loader2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { removeKeyword, getKeywords } from "@/store/slices/rankTrackerSlice";
import { refreshUserPlan } from "@/store/slices/userPlanSlice";

const AddKeywordTable = () => {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const dispatch = useAppDispatch();
  const { keywords, loading } = useAppSelector((state) => state.rankTracker);
  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await dispatch(removeKeyword(id)).unwrap();
      await dispatch(getKeywords({ page: undefined, limit: undefined, search: undefined }));
      await dispatch(refreshUserPlan());
    } catch (error) {
      console.error("Failed to delete keyword:", error);
    } finally {
      setDeletingId(null);
    }
  };

  const getDeviceIcon = (device: string) => {
    const icons: { [key: string]: React.ReactNode } = {
      mobile: <Smartphone className="w-4 h-4 text-gray-600" />,
      desktop: <Monitor className="w-4 h-4 text-gray-600" />,
      tablet: <Tablet className="w-4 h-4 text-gray-600" />,
    };
    return icons[device] || <Monitor className="w-4 h-4 text-gray-600" />;
  };

  const formatSearchEngine = (searchEngine: string) => {
    const engineMap: { [key: string]: string } = {
      google: "google.com",
    };
    return engineMap[searchEngine?.toLowerCase()] || searchEngine;
  };

  function CountryFlag({ code }: { code: string }) {
    return <span className={`fi fi-${code.toLowerCase()} text-xl`} />;
  }

  function GetCountryCode(location: string) {
    const countryCodes = {
      "United States": "us",
      India: "in",
      "United Kingdom": "gb",
      Canada: "ca",
      Australia: "au",
      Germany: "de",
      France: "fr",
      Italy: "it",
      Spain: "es",
      Brazil: "br",
      Russia: "ru",
      Japan: "jp",
      Mexico: "mx",
      Indonesia: "id",
      Turkey: "tr",
      "South Korea": "kr",
    };

    return countryCodes[location as keyof typeof countryCodes] || "us";
  }

  const formatLanguage = (language: string) => {
    const languageMap: { [key: string]: string } = {
      en: "EN",
      es: "ES",
      fr: "FR",
      de: "DE",
      pt: "PT",
      hi: "HI",
      "zh-cn": "ZH",
      ja: "JA",
      ru: "RU",
      ar: "AR",
    };
    return languageMap[language?.toLowerCase()] || language?.toUpperCase();
  };

  if (loading && keywords.length === 0) {
    return (
      <div className="mt-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-gray-600" />
          <span className="ml-2 text-gray-600">Loading keywords...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="keywordAddedTable overflow-y-auto max-h-[166px] custom-scroll border border-gray-200 rounded-lg">
        <table className="w-full bg-white rounded-lgrelative">
          <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Keyword
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Location
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Device
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Search Engine
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Language
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {keywords.map((item, index) => (
              <tr key={index} className="hover:bg-gray-50">
                <td className="px-4 py-1 text-sm text-gray-900">
                  <div className="font-medium">{item.keyword}</div>
                  <div className="text-xs text-gray-500">
                    {item.targetDomain}
                  </div>
                </td>
                <td className="px-4 py-1 text-sm text-gray-900">
                  <div className="flex items-center gap-1">
                    <CountryFlag code={GetCountryCode(item.location)} />
                    <span>{item.location}</span>
                  </div>
                </td>
                <td className="px-4 py-1 text-sm text-gray-900">
                  <div className="flex items-center">
                    {getDeviceIcon(item.device)}
                    <span className="ml-1 capitalize">{item.device}</span>
                  </div>
                </td>
                <td className="px-4 py-1 text-sm text-gray-900">
                  {formatSearchEngine(item.searchEngine || "")}
                </td>
                <td className="px-4 py-1 text-sm text-gray-900">
                  {formatLanguage(item.language || "")}
                </td>
                <td className="px-4 py-1 text-sm text-gray-900">
                  <button
                    onClick={() => handleDelete(item.id)}
                    disabled={deletingId === item.id}
                    className="text-red-600 hover:text-red-800 hover:bg-red-50 p-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Delete keyword"
                  >
                    {deletingId === item.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {keywords.length === 0 && !loading && (
        <div className="text-center py-8 text-gray-500">
          <div className="mb-2">No keywords added yet</div>
          <div className="text-sm">
            Add some keywords above to start tracking their rankings
          </div>
        </div>
      )}
    </div>
  );
};

export default AddKeywordTable;
