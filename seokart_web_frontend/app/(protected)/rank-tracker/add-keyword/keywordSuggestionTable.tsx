"use client";

import React, { useState } from "react";
import {
  Plus,
  Minus,
  Loader2,
  TrendingUp,
  DollarSign,
  Target,
} from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import KeywordSuggestionModal from "./keywordSuggestionModal";

interface KeywordSuggestionTableProps {
  onAddKeyword: (keyword: string) => void;
  addedKeywords?: string[];
  onAddMultipleKeywords?: (keywords: string[]) => void;
}

const KeywordSuggestionTable: React.FC<KeywordSuggestionTableProps> = ({
  onAddKeyword,
  addedKeywords = [],
  onAddMultipleKeywords,
}) => {
  const { keywordSuggestions } = useAppSelector((state) => state.rankTracker);
  const [processingKeyword, setProcessingKeyword] = useState<string | null>(
    null
  );
  const [isLoadingSuggestions, setIsLoadingSuggestions] =
    useState<boolean>(false);

  const handleAdd = async (keyword: string) => {
    setProcessingKeyword(keyword);
    try {
      onAddKeyword(keyword);
      setTimeout(() => setProcessingKeyword(null), 300);
    } catch (error) {
      console.error("Failed to add keyword:", error);
      setProcessingKeyword(null);
    }
  };

  const handleAddMultipleKeywords = (keywords: string[]) => {
    if (onAddMultipleKeywords) {
      onAddMultipleKeywords(keywords);
    } else {
      keywords.forEach((keyword) => onAddKeyword(keyword));
    }
  };

  const isKeywordAdded = (keyword: string) => {
    return addedKeywords.some((k) => k.toLowerCase() === keyword.toLowerCase());
  };

  const getCompetitionColor = (competition: string) => {
    switch (competition?.toLowerCase()) {
      case "low":
        return "text-green-600 bg-green-50";
      case "medium":
        return "text-yellow-600 bg-yellow-50";
      case "high":
        return "text-red-600 bg-red-50";
      default:
        return "text-gray-600 bg-gray-50";
    }
  };

  const getDifficultyColor = (difficulty?: number) => {
    if (!difficulty) return "text-gray-600";
    if (difficulty <= 30) return "text-green-600";
    if (difficulty <= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getIntentIcon = (intent?: string) => {
    switch (intent?.toLowerCase()) {
      case "commercial":
        return <DollarSign className="w-3 h-3" />;
      case "informational":
        return <TrendingUp className="w-3 h-3" />;
      case "navigational":
        return <Target className="w-3 h-3" />;
      case "transactional":
        return <DollarSign className="w-3 h-3" />;
      default:
        return <TrendingUp className="w-3 h-3" />;
    }
  };

  if (isLoadingSuggestions && keywordSuggestions.length === 0) {
    return (
      <div className="mt-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-gray-600" />
          <span className="ml-2 text-gray-600">
            Loading keyword suggestions...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="overflow-y-auto max-h-[426px] border border-gray-200 rounded-lg custom-scroll">
        <table className="w-full bg-white table-fixed border-collapse">
          <thead className="sticky top-0 z-10 bg-gray-50">
            <tr className="border-b border-gray-200 w-full">
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/2">
                Keyword
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-1/2">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {keywordSuggestions.map((item, index) => {
              const isAdded = isKeywordAdded(item.keyword);
              const isProcessing = processingKeyword === item.keyword;

              return (
                <tr
                  key={`${item.keyword}-${index}`}
                  className="hover:bg-gray-50"
                >
                  <td className="px-4 py-1 text-sm text-gray-900 w-1/2">
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{item.keyword}</div>
                    </div>
                  </td>

                  <td className="px-4 py-1 text-right text-sm text-gray-900 w-1/2">
                    <button
                      onClick={() => handleAdd(item.keyword)}
                      disabled={isProcessing || isAdded}
                      className={`p-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                        isAdded
                          ? "text-red-600 hover:text-red-800 hover:bg-red-50"
                          : "text-green-600 hover:text-green-800 hover:bg-green-50"
                      }`}
                      title={isAdded ? "Already added" : "Add to keyword list"}
                    >
                      {isProcessing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : isAdded ? (
                        <Minus className="w-4 h-4" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!isLoadingSuggestions && keywordSuggestions.length > 0 && (
        <div className="mt-4 flex justify-center">
          <KeywordSuggestionModal onAddKeywords={handleAddMultipleKeywords} />
        </div>
      )}

      {keywordSuggestions.length === 0 && !isLoadingSuggestions && (
        <div className="text-center py-8 text-gray-500">
          <div className="mb-2">No keyword suggestions available</div>
          <div className="text-sm">
            Add some keywords above to get related suggestions
          </div>
        </div>
      )}
    </div>
  );
};

export default KeywordSuggestionTable;
