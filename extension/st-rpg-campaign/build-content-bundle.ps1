param(
    [string]$ContentRoot,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $ContentRoot) { $ContentRoot = Join-Path $projectRoot 'campaign-content' }
if (-not $OutputPath) { $OutputPath = Join-Path $PSScriptRoot 'content\content-bundle.json' }

if (-not (Test-Path -LiteralPath $ContentRoot -PathType Container)) {
    throw "Campaign content folder does not exist: $ContentRoot"
}

$collections = @('items', 'abilities', 'people', 'relationships', 'quests', 'facts', 'places', 'worldObjects')
$singletons = @('character', 'scene')
$supportedProperties = $collections + $singletons
$bundle = [ordered]@{
    bundleVersion = 1
    sources = @()
    character = $null
    items = @()
    abilities = @()
    people = @()
    relationships = @()
    quests = @()
    facts = @()
    places = @()
    worldObjects = @()
    scene = $null
}
$seenIds = @{}
foreach ($collection in $collections) { $seenIds[$collection] = @{} }

$files = Get-ChildItem -LiteralPath $ContentRoot -File -Filter '*.json' |
    Where-Object { $_.Name -notmatch '_example\.json$' } |
    Sort-Object Name

foreach ($file in $files) {
    try {
        $document = Get-Content -LiteralPath $file.FullName -Raw -Encoding utf8 | ConvertFrom-Json
    }
    catch {
        throw "Invalid JSON in $($file.Name): $($_.Exception.Message)"
    }

    foreach ($property in $document.PSObject.Properties) {
        if ($property.Name.StartsWith('_')) { continue }
        if ($property.Name -notin $supportedProperties) {
            throw "Unsupported top-level property '$($property.Name)' in $($file.Name). Use: $($supportedProperties -join ', ')."
        }
    }

    $bundle.sources += $file.Name
    foreach ($collection in $collections) {
        $property = $document.PSObject.Properties[$collection]
        if (-not $property) { continue }
        if ($null -eq $property.Value) { continue }
        if ($property.Value -is [string] -or $property.Value -isnot [System.Collections.IEnumerable]) {
            throw "'$collection' must be an array in $($file.Name)."
        }
        foreach ($entry in @($property.Value)) {
            if ($null -eq $entry -or $entry -isnot [psobject]) {
                throw "Every '$collection' entry must be an object in $($file.Name)."
            }
            $id = [string]$entry.id
            if ([string]::IsNullOrWhiteSpace($id)) {
                throw "Every '$collection' entry needs a stable id in $($file.Name)."
            }
            if ($seenIds[$collection].ContainsKey($id)) {
                throw "Duplicate '$collection' id '$id' in $($file.Name) and $($seenIds[$collection][$id])."
            }
            $seenIds[$collection][$id] = $file.Name
            $copy = $entry | ConvertTo-Json -Depth 20 | ConvertFrom-Json
            $copy | Add-Member -NotePropertyName '_sourceFile' -NotePropertyValue $file.Name
            $bundle[$collection] += $copy
        }
    }
    foreach ($singleton in $singletons) {
        $property = $document.PSObject.Properties[$singleton]
        if (-not $property -or $null -eq $property.Value) { continue }
        if ($null -ne $bundle[$singleton]) {
            throw "Only one non-null '$singleton' object may exist across addon files. Duplicate found in $($file.Name)."
        }
        $copy = $property.Value | ConvertTo-Json -Depth 20 | ConvertFrom-Json
        $copy | Add-Member -NotePropertyName '_sourceFile' -NotePropertyValue $file.Name
        $bundle[$singleton] = $copy
    }
}

foreach ($collection in @('items', 'abilities', 'people', 'quests', 'facts', 'places', 'worldObjects')) {
    foreach ($entry in $bundle[$collection]) {
        if ([string]::IsNullOrWhiteSpace([string]$entry.name)) {
            throw "'$collection' entry '$($entry.id)' needs a name (source: $($entry._sourceFile))."
        }
    }
}

if ($null -ne $bundle.character -and [string]::IsNullOrWhiteSpace([string]$bundle.character.name)) {
    throw "The Player Character addon needs a name (source: $($bundle.character._sourceFile))."
}
if ($null -ne $bundle.scene) {
    if ([string]::IsNullOrWhiteSpace([string]$bundle.scene.id)) { throw 'The Current Scene addon needs a stable id.' }
    if ([string]::IsNullOrWhiteSpace([string]$bundle.scene.title)) { throw 'The Current Scene addon needs a title.' }
}

$peopleIds = @{}
foreach ($person in $bundle.people) { $peopleIds[[string]$person.id] = $true }
foreach ($relationship in $bundle.relationships) {
    $source = [string]$relationship.source
    $target = [string]$relationship.target
    $kind = [string]$relationship.kind
    if ([string]::IsNullOrWhiteSpace($source) -or [string]::IsNullOrWhiteSpace($target)) {
        throw "Relationship '$($relationship.id)' needs source and target (source: $($relationship._sourceFile))."
    }
    if ($source -eq $target) { throw "Relationship '$($relationship.id)' must connect two different Actors." }
    if ($source -ne '$player' -and -not $peopleIds.ContainsKey($source)) {
        throw "Relationship '$($relationship.id)' refers to unknown People id '$source'."
    }
    if ($target -ne '$player' -and -not $peopleIds.ContainsKey($target)) {
        throw "Relationship '$($relationship.id)' refers to unknown People id '$target'."
    }
    if ([string]::IsNullOrWhiteSpace($kind)) {
        throw "Relationship '$($relationship.id)' needs a kind."
    }
}


function Assert-AddonReference {
    param(
        [object]$Reference,
        [string[]]$AllowedKinds,
        [string]$Location
    )
    if ($null -eq $Reference) { return }
    $kind = [string]$Reference.kind
    $id = [string]$Reference.id
    if ([string]::IsNullOrWhiteSpace($kind) -or [string]::IsNullOrWhiteSpace($id)) {
        throw "$Location needs kind and id."
    }
    if ($kind -notin $AllowedKinds) { throw "$Location uses unsupported kind '$kind'." }
    if ($kind -eq 'actor' -and $id -eq '$player') { return }
    $collectionByKind = @{
        actor = 'people'
        item = 'items'
        possession = 'items'
        ability = 'abilities'
        quest = 'quests'
        fact = 'facts'
        place = 'places'
        worldObject = 'worldObjects'
        world_object = 'worldObjects'
    }
    $collection = $collectionByKind[$kind]
    if (-not $collection -or -not $seenIds[$collection].ContainsKey($id)) {
        throw "$Location refers to unknown $kind id '$id'."
    }
}

foreach ($quest in $bundle.quests) {
    foreach ($reference in @($quest.involved)) {
        Assert-AddonReference $reference @('actor', 'item', 'ability', 'fact', 'place', 'worldObject', 'world_object') "Quest '$($quest.id)' involved reference"
    }
}
foreach ($fact in $bundle.facts) {
    Assert-AddonReference $fact.subject @('actor', 'item', 'ability', 'quest', 'place', 'worldObject', 'world_object') "Fact '$($fact.id)' subject"
}
foreach ($place in $bundle.places) {
    $parent = [string]$place.parent
    if (-not [string]::IsNullOrWhiteSpace($parent) -and -not $seenIds.places.ContainsKey($parent)) {
        throw "Place '$($place.id)' refers to unknown parent Place '$parent'."
    }
    foreach ($connection in @($place.connections)) {
        $target = [string]$connection.place
        if ([string]::IsNullOrWhiteSpace($target) -or -not $seenIds.places.ContainsKey($target)) {
            throw "Place '$($place.id)' has a connection to unknown Place '$target'."
        }
    }
}
foreach ($worldObject in $bundle.worldObjects) {
    $homePlace = [string]$worldObject.homePlace
    if (-not [string]::IsNullOrWhiteSpace($homePlace) -and -not $seenIds.places.ContainsKey($homePlace)) {
        throw "World Object '$($worldObject.id)' refers to unknown home Place '$homePlace'."
    }
}
if ($null -ne $bundle.scene) {
    $scenePlace = [string]$bundle.scene.place
    if (-not [string]::IsNullOrWhiteSpace($scenePlace) -and -not $seenIds.places.ContainsKey($scenePlace)) {
        throw "Current Scene refers to unknown Place '$scenePlace'."
    }
    foreach ($presence in @($bundle.scene.presences)) {
        Assert-AddonReference $presence.subject @('actor', 'item', 'possession', 'worldObject', 'world_object') "Scene Presence '$($presence.id)' subject"
    }
    foreach ($exit in @($bundle.scene.exits)) {
        $destination = [string]$exit.destinationPlace
        if (-not [string]::IsNullOrWhiteSpace($destination) -and -not $seenIds.places.ContainsKey($destination)) {
            throw "Scene Exit '$($exit.id)' refers to unknown Place '$destination'."
        }
    }
}

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$bundle | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Host "Built Campaign content bundle from $($files.Count) addon file(s): $OutputPath"
