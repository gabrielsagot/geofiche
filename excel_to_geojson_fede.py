#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Convertit un Excel d'établissements en GeoJSON.
- Géo-code via API Adresse (BAN) https://api-adresse.data.gouv.fr
- Cache les résultats pour éviter de re-géocoder
- Conserve toutes les colonnes en propriétés
- Écrit un FeatureCollection GeoJSON

Usage:
  python excel_to_geojson_fede.py "TAB_PRIO_FE_V1_SEPT 2025.xlsx" --sheet "22 09 2025" --addr-col "Adresse" --country "France" --out "etablissements.geojson"

Dépendances: pandas, requests, tqdm
"""
import argparse
import json
import math
import re
import time
from pathlib import Path
from typing import Dict, Any, Optional

import pandas as pd
import requests
from tqdm import tqdm

BAN_URL = "https://api-adresse.data.gouv.fr/search/"

def normalize_address(addr: str) -> str:
    if not isinstance(addr, str):
        return ""
    # Nettoyage simple
    a = re.sub(r"\s+", " ", addr.strip())
    # Supprimer doubles espaces, apostrophes spéciales
    a = a.replace("’", "'")
    return a

def load_cache(path: Path) -> Dict[str, Dict[str, Any]]:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}

def save_cache(path: Path, cache: Dict[str, Dict[str, Any]]) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)

def geocode_ban(q: str, session: requests.Session, timeout: float = 10.0) -> Optional[Dict[str, Any]]:
    params = {"q": q, "limit": 1}
    r = session.get(BAN_URL, params=params, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    feats = data.get("features") or []
    if not feats:
        return None
    f = feats[0]
    props = f.get("properties") or {}
    geom = f.get("geometry") or {}
    coords = geom.get("coordinates") or []
    if len(coords) != 2:
        return None
    return {
        "lon": coords[0],
        "lat": coords[1],
        "label": props.get("label"),
        "score": props.get("score"),
        "type": props.get("type"),
        "result_type": props.get("result_type"),
        "importance": props.get("importance"),
        "citycode": props.get("citycode"),
        "postcode": props.get("postcode"),
        "name": props.get("name"),
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("excel", help="Chemin du fichier Excel")
    ap.add_argument("--sheet", default="22 09 2025", help="Nom de la feuille à lire")
    ap.add_argument("--addr-col", default="Adresse", help="Nom de la colonne adresse")
    ap.add_argument("--country", default="France", help="Pays à suffixer si absent")
    ap.add_argument("--out", default="etablissements.geojson", help="Fichier de sortie GeoJSON")
    ap.add_argument("--cache", default="geocode_cache.json", help="Fichier cache JSON")
    ap.add_argument("--delay", type=float, default=0.15, help="Délai entre requêtes (s)")
    ap.add_argument("--city-col", default="", help="Colonne optionnelle ville/CP à concaténer")
    args = ap.parse_args()

    excel_path = Path(args.excel)
    if not excel_path.exists():
        raise SystemExit(f"Fichier introuvable: {excel_path}")

    df = pd.read_excel(excel_path, sheet_name=args.sheet)
    if args.addr_col not in df.columns:
        raise SystemExit(f"Colonne adresse '{args.addr_col}' absente. Colonnes dispo: {list(df.columns)}")

    # Construire adresse complète
    parts = [args.addr_col]
    if args.city_col and args.city_col in df.columns:
        parts.append(args.city_col)

    def build_full_address(row) -> str:
        chunks = []
        for c in parts:
            val = row.get(c)
            if pd.notna(val):
                chunks.append(str(val))
        base = normalize_address(", ".join(chunks))
        if args.country and args.country.lower() not in base.lower():
            base = f"{base}, {args.country}"
        return base

    df["_full_address"] = df.apply(build_full_address, axis=1)

    cache_path = Path(args.cache)
    cache = load_cache(cache_path)

    session = requests.Session()

    lons, lats, labels, scores = [], [], [], []
    new_hits = 0

    for addr in tqdm(df["_full_address"], desc="Géocodage BAN"):
        cached = cache.get(addr)
        if cached:
            lons.append(cached.get("lon"))
            lats.append(cached.get("lat"))
            labels.append(cached.get("label"))
            scores.append(cached.get("score"))
            continue

        if not addr:
            lons.append(math.nan); lats.append(math.nan); labels.append(None); scores.append(None)
            continue

        try:
            res = geocode_ban(addr, session=session)
            if res:
                cache[addr] = res
                lons.append(res["lon"]); lats.append(res["lat"]); labels.append(res.get("label")); scores.append(res.get("score"))
                new_hits += 1
            else:
                lons.append(math.nan); lats.append(math.nan); labels.append(None); scores.append(None)
        except requests.HTTPError as e:
            # Erreur HTTP: on loggue léger et continue
            print(f"[HTTP {e.response.status_code}] {addr}")
            lons.append(math.nan); lats.append(math.nan); labels.append(None); scores.append(None)
        except Exception as e:
            print(f"[ERR] {addr}: {e}")
            lons.append(math.nan); lats.append(math.nan); labels.append(None); scores.append(None)

        # Respect API
        time.sleep(args.delay)

        # Sauvegarde cache régulièrement
        if new_hits and (new_hits % 50 == 0):
            save_cache(cache_path, cache)

    # Dernière sauvegarde du cache
    save_cache(cache_path, cache)

    df["_lon"] = lons
    df["_lat"] = lats
    df["_ban_label"] = labels
    df["_ban_score"] = scores

    # Construction du GeoJSON
    features = []
    for _, row in df.iterrows():
        lon = row["_lon"]
        lat = row["_lat"]
        if pd.isna(lon) or pd.isna(lat):
            # on garde aussi les non géocodés, mais sans géométrie ?
            # Ici on les ignore pour la carte. Option: stocker séparément.
            continue

        # Convertir toutes les colonnes en types JSON-sérialisables
        props: Dict[str, Any] = {}
        for col in df.columns:
            if col in {"_lon", "_lat", "_full_address"}:
                continue
            val = row[col]
            if pd.isna(val):
                props[col] = None
            else:
                # Convertir timestamps pandas en ISO
                if hasattr(val, "isoformat"):
                    try:
                        props[col] = val.isoformat()
                        continue
                    except Exception:
                        pass
                # Cast basique
                if isinstance(val, (pd.Timestamp,)):
                    props[col] = val.to_pydatetime().isoformat()
                elif isinstance(val, (pd.Timedelta,)):
                    props[col] = str(val)
                else:
                    props[col] = val

        props["_ban_label"] = row["_ban_label"]
        props["_ban_score"] = row["_ban_score"]

        feat = {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
            "properties": props
        }
        features.append(feat)

    fc = {"type": "FeatureCollection", "features": features}
    out_path = Path(args.out)
    out_path.write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
    print(f"GeoJSON écrit: {out_path}  | features: {len(features)}")

if __name__ == "__main__":
    main()
