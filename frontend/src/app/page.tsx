import GraphViewer from "../components/GraphViewer";

export const metadata = {
  title: "Educational Knowledge Graph",
  description: "Mapping 9th-grade math concepts backward to 6th-grade prerequisites.",
};

export default function Home() {
  return (
    <main className="w-full h-screen h-[100dvh] overflow-hidden m-0 p-0 bg-slate-50">
      <GraphViewer />
    </main>
  );
}
