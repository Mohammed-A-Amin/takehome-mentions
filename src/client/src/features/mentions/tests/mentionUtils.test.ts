import { describe, expect, it } from "vitest";
import { removePageMentions, type CommittedMention } from "../model/mentionUtils";

describe("removePageMentions", () => {
  it("removes every mention of a deleted page and preserves other mention ranges", () => {
    const roadmap = "📄 Roadmap ";
    const alex = "@Alex ";
    const value = `Before ${roadmap} middle ${alex} after ${roadmap}`;
    const firstRoadmapStart = value.indexOf(roadmap);
    const alexStart = value.indexOf(alex);
    const secondRoadmapStart = value.lastIndexOf(roadmap);
    const mentions: CommittedMention[] = [
      {
        start: firstRoadmapStart,
        end: firstRoadmapStart + roadmap.length,
        text: roadmap,
        type: "page",
        resultId: "roadmap",
      },
      {
        start: alexStart,
        end: alexStart + alex.length,
        text: alex,
        type: "person",
        resultId: "alex",
      },
      {
        start: secondRoadmapStart,
        end: secondRoadmapStart + roadmap.length,
        text: roadmap,
        type: "page",
        resultId: "roadmap",
      },
    ];
    const expectedValue = `Before  middle ${alex} after `;
    const expectedAlexStart = expectedValue.indexOf(alex);

    expect(removePageMentions(value, mentions, "roadmap", value.length)).toEqual({
      value: expectedValue,
      mentions: [
        {
          start: expectedAlexStart,
          end: expectedAlexStart + alex.length,
          text: alex,
          type: "person",
          resultId: "alex",
        },
      ],
      position: expectedValue.length,
    });
  });

  it("leaves mentions for other pages untouched", () => {
    const value = "📄 Roadmap 📄 Notes ";
    const mentions: CommittedMention[] = [
      { start: 0, end: 11, text: "📄 Roadmap ", type: "page", resultId: "roadmap" },
      { start: 11, end: 20, text: "📄 Notes ", type: "page", resultId: "notes" },
    ];

    expect(removePageMentions(value, mentions, "notes", 5)).toEqual({
      value: "📄 Roadmap ",
      mentions: [{ start: 0, end: 11, text: "📄 Roadmap ", type: "page", resultId: "roadmap" }],
      position: 5,
    });
  });
});
