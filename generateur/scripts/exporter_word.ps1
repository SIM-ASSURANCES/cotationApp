<#
.SYNOPSIS
  Exporte en PDF, avec Word, tous les .docx d'un dossier (référence du test de fidélité par lot).

.DESCRIPTION
  Pilote Word par COM (Word doit être installé sur ce poste). Chaque .docx trouvé sous -Source
  (sous-dossiers compris) donne un PDF au même chemin relatif sous -Sortie. Les fichiers de
  verrouillage (~$...) sont ignorés. Un modèle qui ne s'ouvre pas est signalé puis on continue.
  Les fichiers sont ouverts en lecture seule, sans jamais être enregistrés.

  Ces PDF ne contiennent que des modèles ou des documents de TEST : ne jamais y mettre de
  données clients. Dossiers de travail hors dépôt (ex. C:\essais\).

.EXAMPLE
  .\generateur\scripts\exporter_word.ps1 -Source C:\essais\modeles -Sortie C:\essais\pdf_word
#>
param(
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$Sortie
)

$ErrorActionPreference = "Stop"
$Source = (Resolve-Path $Source).Path
New-Item -ItemType Directory -Force $Sortie | Out-Null
$Sortie = (Resolve-Path $Sortie).Path

$fichiers = Get-ChildItem $Source -Recurse -File -Filter *.docx | Where-Object { $_.Name -notlike '~$*' }
if (-not $fichiers) { throw "Aucun .docx sous $Source" }

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0   # wdAlertsNone
# Sans cela, Word peut attendre indéfiniment une réponse à « mettre à jour les liaisons ? ».
$liaisonsAvant = $word.Options.UpdateLinksAtOpen
$word.Options.UpdateLinksAtOpen = $false
$reussis = 0
$echecs = @()
try {
    "Word $($word.Version) ; $($fichiers.Count) modèle(s)"
    foreach ($f in $fichiers) {
        $relatif = $f.FullName.Substring($Source.Length).TrimStart('\')
        $pdf = Join-Path $Sortie ([IO.Path]::ChangeExtension($relatif, ".pdf"))
        New-Item -ItemType Directory -Force (Split-Path $pdf) | Out-Null
        $doc = $null
        try {
            # Windows PowerShell 5.1 : les paramètres COM de Word se passent en [ref].
            # FileName, ConfirmConversions=$false, ReadOnly=$true, AddToRecentFiles=$false
            $chemin = $f.FullName; $non = $false; $oui = $true
            $doc = $word.Documents.Open([ref]$chemin, [ref]$non, [ref]$oui, [ref]$non)
            $doc.ExportAsFixedFormat([string]$pdf, [int]17)   # 17 = wdExportFormatPDF
            $reussis++
            "  OK   $relatif ($($doc.ComputeStatistics(2)) pages selon Word)"   # 2 = wdStatisticPages
        }
        catch {
            $echecs += $relatif
            "  ECHEC $relatif : $($_.Exception.Message)"
        }
        finally {
            $non = $false
            if ($doc) { $doc.Close([ref]$non) }
        }
    }
}
finally {
    $non = $false
    $word.Options.UpdateLinksAtOpen = $liaisonsAvant
    $word.Quit([ref]$non)
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
"Terminé : $reussis exporté(s), $($echecs.Count) échec(s)."
if ($echecs) { exit 1 }
