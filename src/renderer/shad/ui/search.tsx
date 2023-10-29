import { Input } from './input';

export function Search() {
  return (
    <div>
      <Input
        type="search"
        placeholder="Search..."
        className="w-full md:w-[300px] lg:w-[400px] xl:w-[500px]"
      />
    </div>
  );
}
