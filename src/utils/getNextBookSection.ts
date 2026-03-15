type Section = {
  id: string;
  videoEpisode?: string;
};

type Unit = {
  id: string;
  sections: Section[];
};

type Chapter = {
  id: string;
  units: Unit[];
};

type Book = {
  id: string;
  chapters: Chapter[];
};

export function getNextBookSection(
  book: Book,
  currentSectionId: string
): Section | null {

  const allSections: Section[] = [];

  book.chapters.forEach((ch) => {
    ch.units.forEach((u) => {
      u.sections.forEach((s) => {
        allSections.push(s);
      });
    });
  });

  const index = allSections.findIndex((s) => s.id === currentSectionId);

  if (index === -1) return null;

  return allSections[index + 1] || null;
}