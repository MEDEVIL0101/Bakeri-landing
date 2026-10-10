import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { EmptyState, ErrorBanner, Input, PageHeader, Spinner, useLoad } from '../../components/ui';
import { listRecipes } from '../../lib/data';

export function RecipesPage() {
  const userId = useUserId();
  const { data, loading, error, reload } = useLoad(() => listRecipes(userId), [userId]);
  const [q, setQ] = useState('');
  const [favs, setFavs] = useState(false);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? [])
      .filter((r) => !favs || r.is_favorite)
      .filter((r) => !term || r.name.toLowerCase().includes(term) || r.tags.some((t) => t.toLowerCase().includes(term)));
  }, [data, q, favs]);

  return (
    <div className="page">
      <PageHeader title="Recipes" actions={<Link to="/recipes/new" className="btn btn-primary">New recipe</Link>} />
      <div className="toolbar">
        <div className="pills">
          <button className={`pill ${!favs ? 'active' : ''}`} onClick={() => setFavs(false)}>All</button>
          <button className={`pill ${favs ? 'active' : ''}`} onClick={() => setFavs(true)}>Favourites</button>
        </div>
        <Input type="search" className="search" placeholder="Search recipes or tags…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      <div className="card">
        {loading ? <Spinner /> : rows.length === 0 ? (
          <EmptyState title={q || favs ? 'No recipes match' : 'No recipes yet'} action={!q && !favs && <Link to="/recipes/new" className="btn btn-primary">Add a recipe</Link>} />
        ) : (
          <ul className="list">
            {rows.map((r) => (
              <li key={r.id}>
                <Link to={`/recipes/${r.id}`} className="list-row link-row">
                  <span className="grow">
                    <span className="row-title">{r.is_favorite ? '★ ' : ''}{r.name}</span>
                    <span className="row-sub">
                      Makes {r.yield_quantity} {r.yield_unit}
                      {r.prep_time_minutes + r.bake_time_minutes > 0 ? ` · ${r.prep_time_minutes + r.bake_time_minutes} min` : ''}
                      {r.tags.length ? ` · ${r.tags.join(', ')}` : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
