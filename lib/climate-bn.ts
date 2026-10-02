// Bangla version of the climate story (lib/climate.ts climateStory), written natively rather than
// machine-substituted so the sentences read naturally.
import { calculateTrend, observation, periodDelta, periodLabels, homogeneity, SCENARIO_END, type ClimateData, type Place } from "./climate";
import { toBnDigits } from "./i18n";

const d = (v: number, dec = 1) => toBnDigits(Math.abs(v).toFixed(dec));
const sg = (v: number, dec = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${d(v, dec)}`;
const yr = (v: number | string) => toBnDigits(String(v));

export function climateStoryBn(place: Place, data: ClimateData, year: number, warming: number, rainChange: number) {
  const delta = periodDelta(data), value = observation(data, year, warming, rainChange), p = periodLabels(data);
  const trend = calculateTrend(data.annual), h = homogeneity(data.annual);
  if (year > p.last)
    return `আপনার ${yr(year)} সালের সম্ভাব্য চিত্রে ${place.name}-এর বার্ষিক গড় তাপমাত্রা দাঁড়ায় ${d(value.temperature)}°সে এবং বার্ষিক বৃষ্টিপাত প্রায় ${toBnDigits(Math.round(value.rainfall).toLocaleString("en-US"))} মিমি। এটি ${yr(p.last)} সালের তুলনায় ${yr(SCENARIO_END)} সালের মধ্যে আপনার বেছে নেওয়া ${sg(warming)}°সে উষ্ণায়ন ও ${sg(rainChange, 0)}% বৃষ্টি পরিবর্তনের ফল। এটি একটি সহজ “যদি এমন হয়” হিসাব, জলবায়ু মডেলের পূর্বাভাস নয়। বেশি ছায়া, টেকসই পানি ব্যবস্থা ও স্থানীয় জ্ঞানভিত্তিক পরিকল্পনা মানুষকে মানিয়ে নিতে সাহায্য করে।`;
  const parts: string[] = [`${place.name}-এর জলবায়ু বদলে যাওয়ার গল্প বলে।`];
  if (delta.temperature !== null) parts.push(`${yr(p.recent)}-এর গড় তাপমাত্রা ${yr(p.base)}-এর তুলনায় ${d(delta.temperature, 2)}°সে ${delta.temperature >= 0 ? "বেশি" : "কম"}।`);
  if (delta.rainfall !== null) parts.push(`${yr(p.rainRecent)}-এ গড় বৃষ্টিপাত ${yr(p.rainBase)}-এর তুলনায় ${d(delta.rainfall)}% ${delta.rainfall >= 0 ? "বেশি" : "কম"}।`);
  if (h.tempBreak) parts.push(`${yr(h.tempBreak.year)} সালে ডেটায় একটি অ-জলবায়ুগত লাফ ধরা পড়েছে, তাই শুধু ${yr(h.tempFrom)} সাল থেকে নির্ভরযোগ্য অংশ ব্যবহার করা হয়েছে।`);
  parts.push(trend.tempSignificant
    ? `${yr(trend.years[0])}–${yr(trend.years[1])} সময়ে তাপমাত্রায় পরিসংখ্যানগতভাবে তাৎপর্যপূর্ণ ${trend.direction === "warming" ? "উষ্ণায়ন" : "শীতলতা"} দেখা যায়: প্রতি দশকে ${sg(trend.tempSlopePerDecade, 2)}°সে।`
    : `${yr(trend.years[0])}–${yr(trend.years[1])} সময়ে তাপমাত্রার কোনো স্পষ্ট প্রবণতা এখনো নেই: বছর-বছরের ওঠানামা যেকোনো স্থির পরিবর্তনের চেয়ে বড়।`);
  parts.push(trend.rainSignificant ? `বার্ষিক বৃষ্টিপাত পরিসংখ্যানগতভাবে তাৎপর্যপূর্ণভাবে ${trend.rainDirection === "wetter" ? "বাড়ছে" : "কমছে"}।` : "বার্ষিক বৃষ্টিপাতে কোনো স্পষ্ট প্রবণতা নেই।");
  parts.push("স্যাটেলাইট চিত্র দৃশ্যমান প্রেক্ষাপট দেয়; কেবল তা দিয়ে এসব পরিবর্তনের কারণ ব্যাখ্যা করা যায় না।");
  return parts.join(" ");
}
