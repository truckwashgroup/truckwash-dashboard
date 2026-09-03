"use strict";

/* Truckwash 1 Group - interactie op de statische pagina's. */

const DATA = window.SITE_DATA;

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ============ HULP ============ */
const DAGEN = ["Zondag","Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag"];

/* Postcodetabel: het middelpunt van elk viercijferig postcodegebied.

   De vorige tabel had één punt per DUIZEND postcodes (alleen de eerste twee
   cijfers), sleutel 11 ontbrak en zeven groepen deelden dezelfde opvulwaarde.
   Zes van de achttien vestigingen vonden daardoor hun eigen postcode niet, en
   het voorbeeld 5651 -- de eigen postcode van Eindhoven -- leverde Asten op.
   Met een punt per postcode vindt elke vestiging zichzelf terug en zit de
   schatting er hooguit een paar kilometer naast in plaats van tientallen.

   Bron: de open postcodeset van GeoNames (www.geonames.org, CC BY 4.0),
   4086 gebieden, per postcode samengevoegd tot één middelpunt.

   Vorm, machinaal gegenereerd: vier tekens per postcode, op volgorde van 1000
   tot en met 9999. Eerst twee tekens breedtegraad, dan twee tekens lengtegraad,
   elk als getal in PCALF (grondtal 64) en geteld in duizendsten van een graad
   vanaf PCHOEK. "----" betekent dat de bron dat postcodegebied niet kent. */
const PCALF = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const PCHOEK = [50.700, 3.300];

const PC = "--------------------------------------------aHZEaJY7aYYvaaYdaOYwaHYuZ/Y4aEZTaJZn----aVZRajZeaaZvaeZ3ajZkaPacataCamat--------aZZGahZMatY2arZRa4Y6asZDbCYe------------axYDapX/aYX+aoXlatXbabXOanWy------------aSYkaNYmaDYgZ+YfaQYRaJYUaEYTZ6YPZxYLZxXMaKYEZ3YCaRX2aKXyZ5X4ZuXuaOXbZ7XhZ4XT----Z3YrZ2Y2Z1Y+Z2ZEZ0YXZuYZZtYmZuY+ZqZD----ZdYaZfYmZeYw--------Z/aSZ2am------------Z3ZOZ4ZXZ+ZcZ/ZkaDZ0ZjZVZvZdZ1ZqZaZW----ZHZtZQZ0ZXaIZRaOY9Z3Y/aMY5aQZIaRZGa0----ZraDZfZ7ZxaRZgZdZgZn----ZLXmZEWxYrWv----bCZO--------------------bbZJ------------cGbrcKbg--------cTbY--------------------babJ------------btbM--------------------bFai----bEbKa/bu----bgcO----------------aPWk------------aWWq--------------------ZnXK------------Z2Ww--------------------ZKYbZKYLZNYoY9Y7Y6YRYyYfYtX4YsYOYXYk----Y7ZM----------------------------------------------------------------------------XzdTXtdoXodYXqdNXqdBXucpX6dHYict--------X4dfYNdSX4dq----------------------------Xpbw--------BWqE------------------------YCcV----YPceYYcP------------------------YSeIYKeP--------------------------------YtemY6fA--------------------------------ZAeSY3eBZBemY/eyY3erY5eeY9e8----------------------------------------------------------------------------------------------------------------------------agds----aEdYaJdhaTdqaQd4aHd+aWeCaZeOaSedacdU----Z6daZwdZaCdnaAd0aDeQaFegZ8enaJetaHe4----aPeeateiagetade5anfIaofh----aYe7agfS----Z7fC----ZpfU--------------------Zufk----Zwd/Zsd6Zld1Zmd/ZreHZneSZieKZdeyZpdo----ZqcyZudCZ0c5aUcl----------------------------------------------------------------ZFbQZMbHY/bPZUbQ------------------------YlaI----YmbBYVbW----YKab----ZfbkZYcb----YqdOYkdSYfdYYodGYpc8Yic/----------------Y9dDYxdB--------------------------------YDXzYLX1X9XsYDXS----XlXtX7X+X3XP--------YXW+YqXYX/Wr----YYWFYmWuYsWbYzXK--------cLZ1cWZ+cRaGcfaAcKaScTaeb/aDcGZm--------bzZYblZ1----bEZ2----cJZF----cnYF--------cbZpc4ZQdfZldDYs------------------------ciaVcra0dHa/dPahdgaMdpa0c1aQ------------cKa4b1aldAYKdFX+dQX/c+XYc4XocyXac2XD--------------------------------------------bKX8bSX3bTYFbJYObDYEbNXvbNXibeXybpX+----bMYo------------------------------------cPXO------------cYXJ--------------------cFXm--------cZXU----cmXJ----------------biXe--------buXf----cPYQ----------------bZXD------------------------------------cIW6cNWz------------b3Wwb+Wp------------------------------------------------------------------------------------------------------------------------------------fSfAfde2------------eud3eodgeUdEeUdp----fLeY----fKeEfOdx----fRdafAcq----f8d3----eUbgeUbHeYbredbkekba----eVcGehcC--------duaH----eAZ2eFau----d0Yp----------------ecZpeeZxemZq----eJY8eDYoeWajeIZ0------------esaM----fTa/fVan----fva1gAa2--------fyaVfpahfmaj----------------------------gTcN--------gLbx----f5bb----fqb/fhbu----fVc4fNcSfXcvfQche4bhe4bee/a5fIbbewbn----fXcHficYfyc4----eqcGewcYeRce------------e1YPetYDeoX2e4X2ebXyevYb----------------elYz----e3ZE----fQZ1fWZu----fhZmf/Z3----e7XffRXbfSXnfgXY------------------------gGZDgIYqf4Y+fiYpf4YUf5YD----frX6--------grXdghXc----gRWq----f/XGf1Wt----fmWc----g3WxgiWNgpV1gEV0gOVNhZWxhTXj----hgV+----hyXz--------iKXk----hXYcgtY3gnYUgXX5----hnbF----heb2hjaGg2an----ihaBh9ZXi4a/----jQW8jRWujDWci/Wli+XCiqXOiSWhiNWijNWU----k0XXkkYKlJXxlWYpmNYMldW+kUW2----------------------------------------------------eLWpd5WyeAWteCWjeMWdeMWQeWWa------------eHW3ehXGePW0eZWvelWselW5exW5----eNXE----e1WufBWf----eoXO------------------------d6XweOX/dbYLdZXl----dYXHdrXI------------dqWDduVydjV4----------------------------evV4ejVr--------eqU0--------------------fNV+----fmVY------------------------------------------------------------------------------------------------------------c9VTc5Vj------------dUVx----------------chWB------------------------------------dGWZ------------------------------------d4U5--------eMV5dnVK----------------cEVUb3VOb2VHb8VEcAVJcEVTcAVfb6VVb3VjcBUP----btU+--------SnhD------------------------cTVbcUVicZVqcRVUcKVYcFVlcGVxceVLcPVD----beUtbfUgbbUVbWUNbiUPbdUE----------------bbVM------------bSU6--------------------bGVPbAVY------------------------------------------------------------------------aRU4aHUyaSUsaJUjaTUf------------aRU2----adU/amVGagU1aqU8azVFa2VJ----------------aaVNaPVIaKVMZ9VCaBVNZzVIZ4VR------------aPTYaHTQ--------------------------------acUd------------------------------------asUp----ayViawVsaUVq--------------------bGU+----------------------------------------a3Uy------------------------------------------------------------------------Z0UnZ1UyZqUuZgUhZwUaZ6Uc----------------aAUP--------ZVT9----aBT4----------------ZVUS------------------------------------ZIVoY/V1ZKVZZMVDY9VUZOUn----------------Z2VmZiU6Z9WPYzUQ------------------------YeUlYnUwYZU7YEVmX8VbXyVBX9UNXxTsXpTt----YVToYKTrYeTt----YUT6--------------------XvS/XzTL--------------------------------Y7UHY2T+--------------------------------ZCTc------------------------------------X7R4YJRvYESAYmSe------------------------YXSqYgSm--------X1SlX6Sm----------------XlRgXdRtXTRjXaRaXfRL--------------------XTR1XWR/--------XFRxXBRb----------------WoRVW0RFWSQxWEQeWIQ4--------------------WQSAWQRzWgSGWVRw------------------------V1RBVvRAV1RNVtRJVoRLVoRgVPQh------------VcQtVoQzVjQjVeQaVTQb--------------------VOQRVHQLU/QAU6P3U3PtUuP3U1P+U0QKUyQY----UoPPUnPd--------UjO8------------------------------------------------------------WwSmW1SpWrSvWrTAW3S6W7SsXES4XJSz--------WnSgWaSpWbScXBZX------------------------WrR/WzSMW9STXASe------------------------XJSXXESBXTSY----------------------------WnTPW1TIW6TS----W9UB--------------------XkTHXUTb--------------------------------XdUy--------XOTqXVUEXlUmXnU/------------WLSuWiTI--------------------------------WEUY--------WUUG----WZUW----------------WqVJWnVYWmVlWLU/WWVRWWVXWHVuWMVFV8U+----VnWqVfW3--------ViXq--------------------WqXC------------------------------------W6X4W/YS--------XNXW--------------------XYWv------------WhWT--------------------XyVb------------------------------------XGWE------------XXVb--------------------V+WT------------------------------------W+U3------------------------------------VZRBVWRWVRRK----VSQqVEQ0U5QoU1Q8------------------------------------------------ViP6VePuVjPpVpPyVcP9VXQLVoPXVlPi--------VUP6VQQDVNP7VJP2VUPqVYPw----------------VJPqVEPlVGPe----------------------------VCPRU5PHU8PBVAO8VFPNVOPOVSPIUxPe--------VPOpVKO0VDOfVYOcVUOq--------------------VgPRVfPWVdPLVYO9VhPDVjO7----------------VZPbVUPiVVPYVUPR------------------------VwPKVxPRV0PFV7PSVwPqWBPUWDPe------------VzQoVwQfVqQSVwQSVmQJVyP8V6P7----------------------------------------------------UfQkUmQoUdQZUcQM----UpQx--------------------UCQVUEQlUQQfUNQST/QjUTQnUXQzUIQ2----VARIVFRG--------UWQET7P6----------------UnRuUfR8UbRz----UYRH--------------------UMSXUNSL--------------------------------UIS0UKSm--------UhTV--------------------UNOLUNOUUVOF----UUOfTqOU----T9O2--------UuNu--------UyNkUtOZ--------------------USNjUSNhUUNwUbNi----------------------------------------------------------------VSSoVHSwVLSh----VMSWVNSNVXSXU8SqU+SX----VOTcVNS2VTTDVVS5VeSuVYSkVcS8VfTGVTTT----VhTg------------VvTO--------------------VAVMU8U+U5U5----------------------------VBT/U2UF--------------------------------UQUC------------------------------------VeVN--------------------------------------------------------------------------------------------------------------------UgWAUaV4UrVyU0WAUoWLUgWPUeWlUZWNUZVk----VDWO------------------------------------T4W9------------ThV+--------------------UFVj------------------------------------UMVV------------------------------------UVXG------------T8Xx--------------------TSXO------------TMXl--------------------ThYNTgYi----------------------------------------------------------------------------------------------------------------TBTxTJT/TPULTRUcTYUUTTT0TiUDTpUATATe----TsUmTxUbT9UZT4Ul------------------------S7UDTBUMS9UYTHUgTDUoS6Uc----------------SsUu------------TYU7--------------------SwVp------------------------------------SNVTSDVcSTVCSTVR--------SjVi----SyWp----SiU0--------TJX6TQYj----TZZHTWZASGV9----STXH----SYX0SeXzSiYb----S0Y+------------SQUQSVUMSgUaSTUkSLUWSLUlSpUBSEUESBUx----SATeSBTMR/SuSISxRvTy------------------------------------------------------------TDSjTCSYTISTTDSPS9SPS5Sa----------------TASITDR9S9R/S1SFS4R4S9R3TBRwTBRhS3Rx----TLSnTNSaTMSRTSSqTRSdTVSfTVSVTTSNTOSI----TLRzTSRtTYRnTNRgTfR+TwRdTbRR------------TdSaTlSTTsSTTsSnTsS1TkTA--------T/UI----TLS1SFKETAS+S8TlTJTkTTTiTdTkTsTmTxTk----S5SzSySqSpSwSrS7SiS3SZTHSsTrSmTgSdTf----SpSjSmSPSkSeSZSOSVSlSWSRSrSKSWR4SoRg------------------------------------------------------------------------------------TARLTBRWS6RWS1RQS1Q6S6RHS9Q/TDQ6TGRG----TSQ3TQQuTaQsTbQ5TPRQ--------------------S5QOS7P5SyQHS5QcTBQhTNQcTUQWTJQD--------TEPCTKO6S/O5TIOuTROkTWOdTVOu------------UBNB------------TVPM----------------SJRjSERlSESY--------SSRe--------------------SERHR9RO------------SLRL----------------S1Oy------------------------------------SJQqSCQmSQQZSQQrSlRBSkQfSbPOTUMyTcLZ----R9QGSEP5R2QPRzQARqQfRqQBRyQkRwPzRlQU----SJPCRvPR----RkPA----R7Ot----SKOt--------RrM2R0M9R3NSRnNQRvNi----RnN7------------S0NlSmNfS8MjSsNASlMG----SVNySiOR--------QjNk----QNOrP2NfQhNT----QhMbQqMZP0MQ----RZK+RhKrRRJn----PfOQPZPUPXQXP1PW--------RhRmRhRSRlRJRVQVRGP5----RBPW------------RKSi----Q/SVRiSm------------------------QJR1--------QdQo----QpSD----------------QUTjP5UEQdUT----Q1Ui----RKTt----RETs--------------------------------------------RZVYRSVoRbV/ROVTRPWOQrU5RCVQQ+VjRHV6--------------------------------Q1VeRAWL----RfU+RkVIRXU0RaUeRhUgRUUl----------------R6VDR5UwRxU2RsVC------------------------RrVlR1VvRoVvRpV4RxV6RrWL----------------RgXARiXNRnWvRpXE----R4W0----------------RmX8RkYwRtYB----------------------------R2Yo----------------------------------------------------------------------------UpbMUubWUsa9UebLUbaO--------------------T5ZsUFa9T3aP----UCYd----VAZ0------------UtYh------------UxY0--------------------Uzb4UqcBUfcIUcb7UrbuU2bsVEbwVBb+U5cM----VqYxVnYpVtYmV2ZDVvZBVnZHVkY3ViYbVpYa----V+axVyasVmazVnbHWNah--------------------VTZR--------VEYUU/XcVQXyUlXt------------WIY6--------WIX/------------------------VvZ8--------------------------------------------------------------------------------------------------------------------VtcZVwcfV3cRV4ccV8cZ--------------------VncTVdcXTaS4VTcsVTcbVYcKVhcCVZb0--------VvcEVzcDVrb6V5b7------------------------VybpWIbZV7bSVwbXVibnVCbU----------------V5cGV+cLWBb8WFcBWJby--------------------WFcgWIcYWLcIWPcOWTb8WNch----------------V/clV2cqWAc2----------------------------VucqVkcoVpczVpdJVbc6------------------------------------------------------------WlbQWdbgWfbKWXbXWca/WSbJWca2WRbD--------WVbnWybo--------Wrcg--------------------XCan------------XFbpXXaP----WrZ0--------XaaoXoa5X4bJX4al------------------------XjYbXaYdXtYd----XvZiX+Y8----XfZG--------WnYIWxYdWqYe--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------VqeYVueRVkeHVrd9V2eRV5eGVwe3VheqVYef----VkfeWHes--------------------------------WNdfWUd4Wcdu----------------------------WBdUWCdg----WheVWOeU----WSc/WwdUXDdT----XtfCXjfPXne+XseQ----------------XJeC----YGgfYKgV----YSftYQem--------------------XPfHXHe9XCexXGfTW+fHW7e9----W0fYWLfH----WnjwWXjqWekCWslEXPmzXSlK----------------XRkW--------W4itXHie--------------------WdiSWeio----WMij----------------------------------------------------------------WwgoW1gSW+gnW2gyW6g+Wtg8WlgpWlgWWvgB----XDhDXKg4XQguXcgdXYhHXehM----XOgbXPhS----WchXWLg6WXhKWThZWthYW1h0----------------ZxkSZtkeZkkdZmkGZaj8Z6kbZckgZwkqZulY----Y/kRY+kuZEj5----------------------------X3iAYCjHXrhyXXh2------------------------XChx------------------------------------YOkLYTjt------------X9lm----YLmu--------Zhi+ZYjAZkiqZti1ZwioYkhLZ2h3aPj2Z4iZ----UsjRUxjeUdjQUmjBU2jKUzi1Upjr------------TyjeTyjY--------------------------------UGiZUJiK--------VkiN----Vei/------------VlhK------------------------------------U7f0------------UIfj----Uefy------------VUgX----U9hI--------UihQ----UWhwUziW----T5fwUAf4--------------------------------VNfEVSfo--------------------------------XcgW--------VIeOUreY------------UMcu----UqdJU4c9U8dSUsdcUwdR----UXd+ULdjUScx----SihUSrhKSqhDS7hbSrhgSbhASSg0------------TBg9TQg5SfggSTgT----ShgJSjgw------------TthM----TogKT2hs------------------------TuiKTaiMTbio----------------------------TRjg----Thkk----------------------------S7jf----S4i5S6iQ------------------------R6gjSEg7RcgDRlgW------------------------------------------------------------------------------------------------------------------------------------------------TpeJTleXTgeLTad6Thd2TfdlTWdj------------TafZTifF--------TOffS7fySvgC----Thft----Ttc/Tact----UAchUJcbTdbv----TtbF--------UNcOUKcBUCbz----------------------------SocGSlb0Svb/----THca----SdcQ------------ShcqSjc8Smdk----SYc+SedWSdd4Seeh--------STbt----Sabr----------------------------Rnco--------RodVRfd4RleU----------------RuejR1fA----RpfRSAfg--------------------SdfK--------SRfC----SnevSufN--------RsaBRpaLRuZsRtZ5RxZ4R2aCR2aSRvafRpauR5Za----SEaxR9a6RoatRoba------------------------SZaN----SaZt----SxZq--------------------TDaf----TmaA----TpZz--------------------SMae----Sva5----S8bU----SLbU------------RUY5--------RbZyQyZU--------------------Qici--------Q2cLQMb6QHbZP5bUQEavQUa5----QJZ/----QKY7----------------------------Q6be----Q/bERKa7RYahQwZ6Q1aqQ+as------------------------------------------------O2JpOxJeO/J2----OeKvO2K9O3LhPNLd--------PEMT------------PeKrP2KIPbKAQIJa--------PbJOQKIfQFIG----P/HNQIHzPpICPiGq--------MgE6MmFEMtE1MjEpMWEtMRE7MVFJMcFZMQFe----MlF7------------------------------------NMFpNMFGNREoNwE7----NmD5NdDF------------M8CR----NNDPNBEHMwDV--------------------MLD4----MdDgMkC4------------------------LpEULwEPL1EPL6D8L6ETL9EXMDEkL+EwLwFM--------------------------------------------MYLr------------------------------------LNN0----LcMsLPMELnMKLsLeLuLA------------MbKY----L7K6MxK3------------------------L3Jc----LWJjLeJCLCJMLFInK0IFLPH4--------LdHu----LxIoMDI/------------------------MFIA----LyHXLUG3MBG3MaHC----MhH3--------MkJQMYJUMuJGMuJgM1Jd--------------------M0ISMoIy----M1KEM9JU--------------------MbJiMNJq----NZH5NkJFODIi----------------N0HB----NtGHNiHX------------------------JzDA----KoDRKpCaKBCVKkBfKPEAJnD+--------K4D8----KgFe----JtE9--------------------J2GBJwFr----JfBYKOBU----I/CQJDDOIkCY----J8IQJ3IgJ0I2----JnIsJpIlJyIWJkIeJVJA----JIIdJlHeJkJm----------------------------IVHx----JHHJIWIS------------------------JILyI/MB----IyLuIqL8ImLTI5MVJXNeJ2Mi----I3Ji--------IUJWH8JTISKZ----------------JxKl----JnLlJ8LiKBK4KCL0KdLOKxLOKwKk------------------------------------------------------------------------------------MbPaMePKMlPWMoPiMRPcMKPfMKPP------------MZPqMiP1MZP3MRPtMHPu--------------------LjQU--------LZPsLcQ0--------------------K3QH------------KXRI--------------------NzP7N7P4--------OJPD--------------------M8PR--------NSPQ------------------------OmQt------------OaNZ--------------------N5OY------------------------------------NCOU----NONLNLMeNSMIN3LKOEMhNnOD--------NBSHM+RpNDR3NXSONPShM7SoMzSJMxRxMRSI----NSUJ--------NFUTM/Tn--------------------MfTnMeT4----M0Q7MQRGM8QpNCQa------------N9TZ------------NZTA--------------------NvT/--------NdTa------------------------N2SM--------ORR2----NxRI----OSS/OuTP----OyUTOqUb--------PNVgPDVx----------------O0VQOwVT--------------------------------PrUxPeUj--------------------------------PFTT----OqSSO7RX----PBSEPaR0----------------------------------------------------N4XENsWuNrWgN3WuOCW8ODXTN7XlNvXNNrW9--------ORWWObWeONWmOQW/ONXMOLXZ------------------------NnXfNmXOM/W0NlW+NYWHN0WE----ODWE--------OvWuPFWq----ONXx----N8YZ----NQXd--------NiX3MoW/MqXYOJXiMvXlNUYU----MbYX------------------------------------N2VINrVGNhVFNtUwNnUzNdU4NpUgNiUbNdUn----L7VGMQVG----LqU4LxUC--------------------MvV1------------------------------------OAYFOoYZOKYeOhYMO1YMO2X9O9YhPEYdOyZH----OxXs------------------------------------PRXV--------PxXh----PxV4PYWn------------PBYC------------------------------------PBYYPrYp----NkYU------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------N2b6N0cINlcHNjcBNlcU----NXcGNYcR--------NQb9NJcB--------NRbpNIbn--------------------NPbL--------N0aQNnaaNabaNZb0--------NhbzNnbaNxazNrbJN1afNobxN8a5N3bYN5bv----M0bRM7bVNAbz--------N0cyN4cs----NqdA----NxdgNddRNxdP--------NKda----------------OOc0--------OadZ----OGeG----------------MXcq--------ModAL4cu----MDdW----Mddz----MaeR--------LEc5KwcjKxdW------------OWZMOeZZOmZeOiZyOcZrOTaJOvaCOVZd----O+Zs----LgZf----LuYaKlW9------------------------N4ZSN5Zd----NnY0NrZ5NLZn----------------MVaK----Mxa0----------------------------PbbfPeb3PVb5PSbmPnbZPObM----------------PfdQPXcg----Pocv----P/cuP+b/P5cn--------PPa3------------PZZw--------------------O+bFO5a5--------OcbuORaq----------------------------------------------------------------------------------------------------------------------------------------PdfTPlfZPjfq----PdfuPWfmV2PX------------QAemPre3Pfe/Pmeo------------------------PyfWPwfuP3flQBfEQDfYQJfrQGfH------------P6gKPzgUP9gXP4gmQJgEPnf7QHgTPtgfQFg1----PmdxPnd1PgdUPxdbQFdBQDczQJdfPQg3--------O9fMOwfAPBe8PNfF----O+eN----OmeH--------OxgOOvgM--------PHga--------------------N2flOBfeN7f2----------------------------OTgHObgdOagLOUgV----OQfI----NkgV--------RTecRLef--------RScrRcb/RAbyQ6cm--------RJdt----RUdVQ+eSQzd+QvdfQodIQYdM--------QYeo--------QaeAQadp----RWffRNft--------Qwfx----QgfvQsfUQ/f9--------------------QsitQhi6QZioQdieQriaQ1ioQ3i/Qui9QmjN----QpjpRNkXRfkHRbkaRRkqRAlIQ0lERAklQwla----QgmH----QZl0QRmO----RgjWRRjDROjs--------RIkm----QvkiQSkdQUlP--------------------Pxh1PuhaPviJQGiy----Qch2----PqjW--------QHhjQHhO----RhidRKiSRMhzRShYRDgq--------O/kHPGkOPGkfO4kOO6koO5kP----OokpOvlo----PklJ------------------------------------NZlWNelfNvluNxmmNIls----OHlKONmE--------QEoSQPoBQboGP6n8Ploo----QAnhQPmvQVnm----PmpJQBg4PeoC----NvmbO6nVO/ob----NhnE----Pcmu----Prl+PRnMO8mq--------------------OXjEOUi4OMjMOkjYN7jAOJicOcjS----N+kC----PUiiPRigO4iE--------O7jM----------------OWhQOZhe--------------------------------NnhxNZht--------------------------------LQg2LVhFLLg/LAgzLGgnLMgmLSgVLZgqLcg4----K5f+LRfCLrf3----------------------------KQfg--------KlgGKefU----KXekK5eyK5eT----Kcd9--------K5dx------------------------Kbc9------------------------------------KPhTKUhqKRh8KKhtKKh7Jahi----------------KPgk----J3g8----------------------------JqgC------------JNfl--------------------KxhgK6h7K4iJ----------------------------Kpjg------------KJjM------------------------------------------------------------LhiELth+LiiWLYiQLZh/LkhwLrht------------LzhtL3h1L3iCMChtMEh/MKhSMRhgMMh8MVh8----L5iSMJiUMWiT----------------------------LrisLjinLTiZLOiNLUijLOihLSiw------------LuhfLjhaLUhhLRhtLLhcLHhsLvgzLkg+--------LIjBLYjILMjFLOjULOjjLUjgLbjZ------------MGjIL9jJMFjYMGjF------------------------M1g8MwgqMog0MjgoMhga--------MnfcMefd----MwiKMziE----Myik------------------------MNk8MZlAMMlQL8ljMDlBL7kcMJkmMEkKMNlg----KultKalv--------LRlM--------------------K2m/LGmd----LVmMKpmk--------------------LlkN------------MqkW----Myj1NJjg--------NCkZ------------------------------------L5m+MKnELtm6L4nP----LdmmLInaKdoGKsox----MimB----MkmyNRnS----LnoZ----KEoY--------------------------------------------------------------------------------------------------------------------------------M4psM2p/NBqENFpv--------M7qdMpquMop3----MaqqMlpYMUomMOphM+pENPoHNgqQ------------N/qT----NnqsNrqTNnpWOMqIOXp0------------O0pW------------PNpKOnpo----------------ODoA----NxoEN2osOeoVOooL----------------Ooqc----O2ruOHrANcrjNDsb----------------NErYNSq8M9r4MrriMbrqMZsD----------------McspMQss--------------------------------------------------------------------------------------------------------------------------------------------------------Kfs3KVsyKctEKps9KRtHKutO----------------KbsgKisbKWsaKbsPKksNKSsOKksAK1sP--------KEsYJ6sk--------J4sK--------------------LKs1----Lss5MRtN------------------------JjsE----JHrbI3q2------------------------LyrBL5riLjq8MDqu----Lqpq----------------LQsZ----L3sl----LEqvLMqKK+pa------------Jzp3--------KSqHKWpRJ9pTJmpxJuqK--------J2rp----KXq9----JQq8--------------------IqlnIvlLI3loIql7IWmCIdlf----------------IHm/HpmxHqnPHYnaHRnG----HOnw----HOoU----I8jk----InjbIajn----JjkPJajkJJjOKNkO----JKmQ--------JBm0Jbm6----IKne----Hulv----Hup/HyqXHoqVHgqUHdqS------------Hdpo----G7of--------------------------------GtrUGmqr----Gxre----GqpW----HHpO------------IHq/--------HMqdHIrR----G6qN------------IWpfIVp2Ihpm----H/pSIzqA----I3pCJXol----IlnpImn0Inoh----IPoVHvn+Hiof----Hqo5----GVoOGLoh----FhpcGFps----Gun2----Gdnk----GeonGiop----FuoA----F9nU----FRoC--------FOnOFWnPFcnZFWm0FImx----FUmq----Eomo----EroGEkoaEgoAEjn3Eyn5EzoMEsoc------------E4nqEonbE6nX----------------------------EToE----ERob----D+oM--------------------ELnbEUnlEbnXEAngEGngEQntEhnC------------ENmk--------D+n0----Dwnr----------------D6mk------------------------------------DxnF----------------------------Demz--------------------------------------------CWlUCKlWCKk/CSlGCNkuCVk3CclCCkk1CklU----CTljCmlsC4laCXlsCil/CUl6CLl8B/l5CDlo----C5mS------------DNmw----Dbmg------------DFmB----DemS----BPlt----Brl+------------BrmiBpmh--------BInX--------------------BSm9BanM--------Bgmm----CCmgCRmqB5na----Bxob----B1n/Bknq----BLoQBFn/BSn8--------BdpB------------BIoyBupOB/pQ----CNo7----BIqb--------BVplBUqC--------------------Clne------------CYoK----CBnw------------CkofCjog--------------------------------CIog------------Chm5----------------------------DMna--------C+n6----------------CkoKChoGCyoZ----------------------------B2qR----B2px----------------------------Daob----DOob----DxoW----CupJ----CHp5----DJqcC7qbDPqqDYq8------------------------------------------------------------------------------------------------------------------------------------------------CyprDCpqDLpTDcpsCzpxCxqDCup5CIpzCspn----DkpcCRqO--------------------------------A6mzDPorDSpD--------Dvo+----D5ozELow----D6prD8p4Dxp0DxpkDqpzDqpTD/pM------------EMp6--------EYpR----EOpN----------------CkrQCarQCtrPC1rSCWqkCgqoCmqmCwq5DAq6----C/rK------------------------------------------------------------------------------------------------------------------------------------------------------------R6oDR0n8--------Scny--------------------RzoOR1oVRsoYRvoFRhoH--------------------Rrn1RmnoRbnyRZnYRSngRNnNRZm/RcnJ--------R8nwR1nuRvnhRqnSRtnGRsm0----------------SDnR------------------------------------Q8pFQupT----RdoZ----SLq6----------------RjozRjo6RppERtotR2pOSFpMR+pjRzqESLqW----Q6n6Qsnt----QsoOQdoZQNo8QDo3------------Pjp1------------Ptp/QCpY----PNqDP1qi----Ral1RTl6RNmVRjmJRKl6RKlH----------------Qmm4QwmPQ6lv----RjlfRtlNSBk/------------R9hV--------Rdgs----Rkh7Rmi8R+jWRujq----SDkH--------Rkka------------------------SImkSAmf----SOmCScll--------------------Skj/SckASkk/SckdSbjz----SgjJScioSbh7----THn1S+nvSOoD----TrnRTomX----TjlnS8k1----TLluTRlfS5l7S7mDS8m5TTm4Sjm4Scnc--------Sqoo--------SmoJSeo6SrqAS/pf------------Sapr------------------------------------Tyk8TvkvT0lMUDlZUJlaT8lIT4k9UAk2T0ks----U9lIVDk4U5k3VAkqU+kfUrkiUsk6VIkl--------UXlH------------------------------------V0mnWZmTWBlv----------------------------VvkU--------VQjpU/jn--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------UBouUEoTUMoWUJokUYovU+oST4pQ------------UKo1ULo+UXpOULpMUDpnUCpYT6pIUBo+--------TqohTvozTyo5Too/TlorTboi----------------T1omTroTTroCTgn+TfoKTnnv----------------TQpLTbpB--------------------------------ULnrUDny--------T/m/UAmQ--------T7nP----T+mC--------Uam9--------Vfor------------USpxUKpvUJp7----------------------------UYpl------------------------------------TNrZTQroTXrSTQrITDrk------------S3sC----Snqz----SoreSZr1SKsBSDrzR+sf------------TiqfTZqTTOqmTOp3------------------------TrpvTgp1--------------------------------TfsNTVsU--------------------------------VMrvVIroVAr4----UzrlVOr8VjrX------------V7rE--------WCrt------------------------Vysn--------VfsXWbsM--------------------UisXUbscUWsMUqss----UPsUUOrPULqt--------UZqp--------UnrL----Uhs/UZtXUPtkUYt7----TyuvT4vETvu+TlvOTevATwuQTmuZT3udT9uw----TMvk------------------------------------Ubvm------------UQw3--------------------Tstb------------TWt2TLtUS5tISzuQSbtr----SZuJ--------SguWSju8S8u4TKuUTSuk--------TbxX--------TiwtTvxr--------------------TFvv--------S5wQTAxP--------------------SowF------------TAvaSkvxSDvGR1wS--------SVwD----SUwxSdxc------------------------SMxz------------Smx9--------------------T31fTz1OUA1eUf1LUV2AUA2wTd2TTO1XTb0m------------UE2G----Tk16------------Ty0g----TKzcTJzATAzZ--------Tbz5----------------UIzFUAy1----UGzwT/yOUbySUfzf------------U9zwU30b------------YVsz----------------V30NVz0h------------VUzBV01h------------Wdzt------------Wk0e--------------------------------------------------------------------------------------------------------------------------------------------WhtSWptOWqtiWctcWhtAWQtUWRt0------------W8tv----XdtXX0teXit5X0u0XcuwW1u3--------VUtH----Vdt0VKshU/sNVhtDVEtu------------Wet2WYt2V4t0VsuS------------------------WxwlWxwg----Wbw7XZwB--------------------V8vK------------VIvKUyuz----------------Vnxt----Ugxn----------------------------WIyT----WCzNWfyWW+ya--------------------------------------------------------------------------------------------------------------------------------------------XppmXhpOXwpHXvpWX5peX5poX9pv------------Xqp9Xxp8X7qFYFqKXrqWXXqWXRqJXeqAXZqN----XdpsXap4XQpuXQpiXapeXYpS--------XNpO----YSqU------------YSpfXuoL----XDnj--------WQoSWDoR--------------------------------W6pg--------W1qI------------------------WLql----------------------------Y3rH----W8q6XBrUXBsVX6sP------------------------YEsGX/sF--------YBq9YrrnY8rG----WssQ--------------------------------------------YQssYcsaYZsrYnsfYhsxYWs6YTtAYItIYNsb----YItpYLtfYStcYbtlYYtvYSuGYMt9X+uHYNtq----Y1sj----YitSYpueY6vL----YNuy----YJsg----Z8xVZ7xoaKxp------------ajxNZ/wN--------Ytww------------------------------------ZZy1ZDyIZLx8--------Zgx+ZkyWZQyv--------X/zTYMzl--------X8yC--------Xay+--------Wt19W51jW81r----------------------------YX1T------------YZ0oXc0JXz06----------------------------------------------------Xw4QXq4OXs3/X24L------------------------X53pYF3rYA4KYR4WYW4y--------------------X54hXw5OXx4kXn5OXp4gXO4s----------------Xl4TXV4RXh36XU35Xp3sXV3hXy3TXd2o--------Ye2kYY28YT2iX72LYa2PYn2iYk23Yx3MY620----ZC3WZC37--------------------------------ds4vZM4nZO40ZA40Y+4oZO4UZY4i------------Yc56YW50--------X65tYB6YZN5tZ354--------aR5+------------Zy3nZ14qZi2x------------Zt0saF0caF05Z70NZy0aZt0YZ30oaO00Zi0NaW0PaO0B--------aR1PaU1a--------------------Y91zZA1+ZD2J----ZX1gZT2IZM0d------------as4R--------ap5DbA5jab4Ga64ca43z--------aJzbZyy7--------ady+--------------------as2d------------------------------------bF3LbK3+bO3AbT2YaF2DaQ2xaU3Xaq3R--------atz6axzy--------bo1KbRzo----a61mbi1c----bgzD----bkyA----cEzIbxzDbNzPbByn--------cfzwcTzNb50RcE0scp0ic7z+----------------dsxZdoxe--------eCx/----dvwK------------c0uZ------------dxuW--------------------cTuNcXuZ--------------------------------cgwycpxF----cOv9crxNcTync4yAdHwRdbv1----eu1ren1+--------------------------------fJ2B----e90hfp14fK21e324----------------es3/--------fK3se05qej40----------------dNzpdbz3dZzo----d4zBeHy0eby2dh0teU04----eXzdeez8d00sd50Ndq0Udn1Hd51OeL0a--------dQ1WdD0vdL0fc5zNcky4dVzHdOyhdmzf------------------------------------------------gj4LgQ4CgI3rg04Qgy4K--------------------gX4cgr4Ugs41gh4tgF43gY5LgA4Gfx4Y--------hp5g----fd3o----------------------------gW2ugX2+gA20fb3cfn2xgr2uhC3Fhg2Bhq18----gx1phL1bhd1igt1Wgi0/gb13----h92Nh62T----gH1e----gA0+fn0t------------------------hU3mhZ4Chl3fhe2miA3xiC5KiM6F------------g96X--------gH6gf+5P----fV3e----gS52----fo5ofw5X----fj6ehc6S--------------------fqxmfpxvfxyFfoyMfgyCfgxxfhxkfgxNfnxQgAzVfpy5ftzBfXydfoyje+yBe4zVfs0AfKzx--------ezw3--------erwEeQxceuyAe6xwgYx8fQ0H----f4xTfYwMghxKgEyCgdxFgBysgTyYgTzo----fjtDfMtLfVtJfMtmfBtB----fPr1----fttAfEuX----eJtj--------eIs4elu1----e1uwfQvO--------fquO----gYv3gmvlfNuTe6uO----------------gat5----gjtSgbtEgqul--------------------htvL----huuUhjvdh+v7hSu1----------------g3vA----------------------------------------------------------------------------cUrocMr0cEsHb5r+bqsGb2rzcGrp----cOrW----cZrtcdr5cVr9cfsUcRsHcCsy----cys9--------cirgcorwcrr6cssJc/so--------------------cVrQcdq9cqrFcyq3dCrM--------------------btrJb1rB--------bftA--------------------djrw--------eWrW----ezrK----------------aPmraTnF--------Y5mwZmnJaDl0----bwpL----bDnhbWoE----ayoTawnf--------------------bjpy--------buqfbPpQbPoubnoj------------aTuTaVuiagup----apv5aTvOaAtb------------ZeukZVvj--------------------------------ZlsC--------Zftb------------------------aYsd------------------------------------bKt4--------bJtN----bov6b+wRbYwn--------bSvqbQvbbEvjbKu9------------------------ZvqEZxpv------------ZSprZtqw------------Y1pxYuph--------------------------------aZqy------------------------------------bBrV----ahr5aOro----Zfrl----axsI------------------------------------------------csimcVic--------------------baigcAi6----dBiRcqiQcfiKcViJcKiOcCiU----------------cbh4cQh5cIiA--------------------b8iH----cvhtcdhkcOhkcFhIcBhq--------------------cfl7cVlqculfcjl3dNkmbQls----------------dBo5dGordJoYdBohc2osczpBdTo1----cloU----dKpN--------clprcsqacaqQdcpLcXpH--------dxqs------------------------------------dfqc----dLqSdUq1------------------------fYmZfimOfZmDfRmaffm1----eSngeVl4e7lC----fokngRk3g8ljgWmWgBnxfYoIeooq----eYmr----erkFeskaekkl----e7pge3qQ----------------glsBgvsQghskgyrqg9rbhDrzhLrdhNrKhDrG----g3rKg6qtgdr8gbsogws1hCsEhMsU------------hMtp------------ftrZfqpo----------------g/pkgGppgPqD----------------------------gMqef1pYgTolgqnuhJpyg8o8gephhAqQ--------hstbhhtDhbsxhtsuh/tHiMuJiQtoiUszijsj----iMsbiitVh8sFiNrohsrahkrAhfq3hTqd--------kArQ----jmqzjtqTj4p5kdqAkQq4kNrskdsY----j3sGkAsvjXrejLrIjVqv--------------------i+sPjUtDjmtpjCt8jYupjMvrjawIjxvh--------jzuxkjvAk9vakzukkPt5----ituKiouciRvD----jZo6jQpEjEpRi8pYi+pIjMo3jXosjVpZjxoz----i7pgi4pDjIpfi9qLjGqfjcp2kNpoj7pVj2pB----i8ojijoxiyn1i4oAjYoQjZofj9n9j6oRjyoZ----h+qKiDqY----iQq7imrcidqsikqFh5pxhvpZ----hdozhHoQhSoMhlnxhkoWh8o+iOpgiWqAg6nw----kunp----klmwk2n2ktoi----lToo------------jZnFjfnSjUmu----jum4jNniiunfiAni--------kImojnmri9nTi1nNisnFibmOjEmx------------ixmLiflMi1lsi9lajTl2jVmMi+l8jPlpjLk2----hlllhsli----h1l6iJmFh8mlh7nBhenAh7nX----j+m5kJm2--------------------------------jCkajUkfjIkRi7kG----iTks----------------iWjq----iNkLiJjgh7j4htjchoi6------------iUjMh2iUhuhzh5hu------------------------ixjBidiuiTibiFhv----------------------------------------------------------------kdkuklk1klk/khlOkdlEkYlDkQk6kUkt--------eQmSjnjPjwirj0jLkTi4kMjHkQjgkLj9--------jbkLjnkuj4ksj+lokHlckal2k2lukylck6lK----kwlCk3kXkmkc----lVlcltlGlolY------------lbk2lQk8----lTlw--------k/l1------------kHkS------------------------kKiq------------------------------------------------------------------------------------------------------------------------------------------------------------------------k8iwlBi8--------------------------------jlhg----jBg3----iHgQ--------------------iBg8iWg4imhmjNiP------------------------lojxl3jnl6kJldkPlhkplJkglKj/------------lCjelUjDlOiwlOiGlCiClMholQhLlih5lwha----lzg1lFf1lPgrk0g1kohHkhg+kOhCkohjk0hz----kBhVkCiNkMiAkTiQklibkPdz----------------kvjlkskGkhkAkijJjqiK----------------------------------------------------------------------------------------------------m2jCm9jA----mZjYmhixmRiLm1iTnNjEnTjY----nbj0nKj3nBjim5kA----nGkO----------------mJhYl9iCl6i3----------------------------mUkcmdk/mVlKmKlBmDku--------------------mhkdmjkBmKkDlwkdlpi+--------------------nqjHn3jSnfiynoiknViJnRh5nAhv------------mrhPmfhW--------------------------------mzh3mShU--------------------------------pqeBp1ejp1exp2e4pze3--------------------qAfCp2fIp/fOqEfYqHfrqJf7qQge----ombn--------------------------------------------nGnBm8monFmxnHmlnNmmnLmynNm8nUm/nYmv----nInPnOnInTnRnMnZnMnvnSnunXnm------------m3m2m8m9nCnNm8nLm3nUm9nZnAnYnDn0mynq----mlnI--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------lZnp----mQonmeoFmSnxl+ngl0nQlxm1lenC----lKm9lemblPmQlGmG------------------------lrmAl+lzmNlsmPmMmamGmhmJmiln------------mul+mxlsm8l5nPl7m+kpnTk5nUkTnelx--------nuku----n3kUnolUnnln----n4j3------------oAmg----oTmYofmin4m1nvmunlm1------------ntofn3onn4o5oFod--------oCo3------------ocl8okkxo/nFotm0oSjkohkooSlkosluoPjr----ndnYnoninYnOmunImwnmmunrmVnZmSnHmImy----oEnr------------------------------------pBqLpJqKo4qUodqIolpfo3pco1o0oNqGoFqS----okoSogoPojqpolq8------------------------pRqRpaqupkrOpYrYpFq+--------------------pIrxo9sZp1sbp5rmpvrlqNrjp3rApnq7--------qMqaqPrbqIq8pvqGp6pppiqSpnpqpZpw--------psorpho7pdpIpVpUpCpUpJpl----------------q4kjq6lYq8mprAnE----rcsu----------------pcoEpOnepJn5pAoOo9oepCo3ozoQomn0----------------------------------------------------------------------------------------lurrlpsAlirvlfrTlZrGltrQlqr9------------lPrPlSq4lhquljqZlaphl4qFmFqomBrHmTqv----mNrzmCsdmUsb----------------------------mxs1----mdsY----------------------------kxtW----lMuTk4ralAqMlAr2lcs0lht/lota----m+qE--------nTpTnOo0ndo2nbqTnRrM--------mvrPmsqSmhpvl/pVmvpB------------nrqC----oAqs------------------------------------m1sT----nJtDnVstn2senorpntq9nUrrnFr+----oVshoJs/o1tIoXsAohrhoRrloFr4oCrcnyq8----mGwzmBwg----lvxWlvwxlsw8lhwh------------l+wXmawZmXw4mYxSmmxh--------------------mOx8------------------------------------lBxX----lZxIk3x9kjxZkNxskyxD------------kewalNwMlPva----------------------------mcwF--------lzvvm6wPmiv2--------nDvc----m1vZm3vTmMuUmTu7mZvSl/vDlyuP------------------------------------------------------------------------------------------------------------------------------------j2y+kAy7kLzWjvzMjuyej+yrkOy9j/yLkJzw----hwyMh7yUhlyLityqiTx3iixMhGxhhCySgoy3----jlxsjHxMigwH----------------------------hqzsh20IiFzghZzphHzUgyzwg/0BhIz8hL0g----hj0tiG0Qii1Ri60sjG0bjBztjG1Wjb0cjb0r----jr0Xjiz9jYz0jNzmjLzIjSzTjrztj30DkT0I----j/2Kjj2gkQ1tke2cj806kg0kkr1Mk21clF0s----lY0wlK1Elu1Yli16lt0y------------l30i----lFzNlMzzlB0Xkv0Lkez6kezGkXytkeyTkKyV----kryskuzQlszqlvzal7yYluyYlbys------------j25Cjw5Xjx4+----------------------------kV3Skt3Y----jv3fj54W--------------------jX46----jp4bi739jb3kjQ3OjH2+i43Q--------is2h----jO2jie2GiT1tig26iP2b------------kS7j------------j48l--------------------i/70------------------------------------h/6t----ii6miq6S----ky71----------------if4z----i65Bia4S------------------------i+59--------jg6Djp5/--------------------ke6d------------------------------------mg2DmV12mW2J----lu2VmL1Xml1bm004m20V----mg2h----ng0anT0mmu1ynC1PnT04nX1wm92Y----nU2rnt0tnq06n31voS2Znk23n53Sn03woL3V----lq3EmC2zmL3F----m/3ymh3s----------------lk35ld3n----lZ4elw39lt3u----lM3ymC3x----mF4o--------lL2slT2HlJ2KlC2Skw2vk23N----kt51----lE5L----lk58--------------------mL6XmK6nmE6UmO6HmV6U----mZ5/mO5omq5a----m86BnC6k----nB7Pmj6ymq7Sm68WnY8D--------m488----my9E----lp8ZmM8Clo6/lA68lG7y--------------------------------------------nVzGnay/ndzRnizJnlzEnmy+ndy0nVyz--------m/zJnCzWnOzknPzOnMzGnRy1nKy0m8y3--------nnzanmz4nrz6nnz5nqzon1zlnzzZnyzG--------nmy0nhypndyenKyFnXyGnoyQnvyh----m+xP----mqzumlzimoz+----mX0OmH0C----------------mEzA------------mQy+mxyk----------------ohyk----oryfoPyj------------------------opzm--------oQzWoCzd--------------------oR1Eok1noz1zoq1SoM1oom0moJ0Xnz0a--------nywe--------oBwXntwT--------------------nTwmnUwk--------------------------------navcnevv----mLt9m0u0----m9wsnGxG--------n8xZnexNoLxD----------------------------oIvnoHvgoCu+oXuaoFuG--------------------oOtyokt3otuZ----------------------------nRufnZu/nEuEmwuJmmtUnnuP----------------nrtjnntfntta----------------------------obvNobvSoqwWodv3o0u8o2wv----------------oxxHotxgopx5----------------------------o/3ko43wo53bpd3bpi32p63ppz3Ppx26qD3T----pN27pX2rpP2ZpZ2Eps2T----o62hoy2LpH13----o/1DpV1Spt1Zpt1Sp11W--------------------pL4So94MpP4cpF4i----o74uoc4e----oS38--------nc5AnP46nw5hn74xoM6Toj6ioo6Wol6E----pHyW----plyQpfyppsyTqFyNp6xy----pKzX----pZxdpHxNpPw0pjwwpjwIpMwFpnxYqMxLqPxt----pjvbpSvUpMvhpOu8pmuzqJtiqAwRp/vtq43K----qQ0Oqc1jqf2Pqq28qO18qF1aqG2DqQzwqEy6----pV0OpX0vpJ0Spe0Kpp0Fp31DqA00p6z4Y2o5";

function openNu(loc) {
  const nu = new Date();
  const rij = (loc.uren || []).find(u => u.dag === DAGEN[nu.getDay()]);
  if (!rij || !rij.tijd || /gesloten/i.test(rij.tijd)) return { open: false, tekst: "Vandaag gesloten" };
  const m = rij.tijd.match(/(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})/);
  if (!m) return { open: false, tekst: rij.tijd };
  const min = nu.getHours() * 60 + nu.getMinutes();
  const van = +m[1] * 60 + +m[2], tot = +m[3] * 60 + +m[4];
  return min >= van && min < tot
    ? { open: true,  tekst: `Nu open &middot; tot ${m[3]}:${m[4]}` }
    : { open: false, tekst: `Vandaag ${m[1]}:${m[2]} &ndash; ${m[3]}:${m[4]}` };
}

/* Zet de open/dicht-badge en de "vandaag"-rij op een vestigingspagina goed.

   Waarom dit bij de bezoeker gebeurt en niet in de gegenereerde HTML staat:
   webbouw.cjs draait de paginafuncties uit brok.js in een sandbox en schrijft de
   uitkomst als vaste tekst weg. Alles wat van new Date() afhangt bevriest
   daarmee op het moment van bouwen. De bouw van maandag 31 augustus 2026, 16:49,
   zette op alle achttien vestigingspagina's permanent "Nu open - tot 18:00" en
   markeerde maandag als vandaag, ook om drie uur 's nachts en op zondag.

   Door het bij het laden opnieuw uit te rekenen klopt het weer met het moment
   waarop iemand kijkt, en het blijft kloppen na een herbouw: deze code
   overschrijft wat de generator ook invriest. Daarom staat de reparatie hier en
   niet in achttien losse HTML-bestanden.

   De tijden komen uit de tabel op de pagina zelf en niet uit data.js. Die tabel
   zet dezelfde generator uit site.json en is dus letterlijk wat de bezoeker
   leest; data.js is een apart bestand dat daarvan kan afwijken. Zo kan de badge
   nooit iets anders beweren dan de tabel eronder. */
function ijkOpeningstijden() {
  const tabel = document.querySelector("table.uren");
  if (!tabel) return;

  const uren = [];
  [...tabel.querySelectorAll("tr")].forEach(tr => {
    const dag = tr.cells[0] ? tr.cells[0].textContent.trim() : "";
    if (DAGEN.indexOf(dag) < 0) return;
    uren.push({ dag: dag, tijd: tr.cells[1] ? tr.cells[1].textContent.trim() : "", rij: tr });
  });
  if (!uren.length) return;

  const vandaag = DAGEN[new Date().getDay()];
  uren.forEach(u => u.rij.classList.toggle("vandaag", u.dag === vandaag));

  const badge = document.querySelector(".detailkop .nu");
  if (!badge) return;
  const st = openNu({ uren: uren });
  badge.classList.remove("open", "gesloten");
  badge.classList.add(st.open ? "open" : "gesloten");
  /* innerHTML mag hier: openNu levert alleen cijfers plus de entiteiten
     &middot; en &ndash;, niets uit de pagina en niets van de bezoeker. */
  badge.innerHTML = "<i></i>" + st.tekst;
}

function afstandKm(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  /* Onafgerond teruggeven en pas bij het tonen afronden. Er werd hier al
     afgerond, waardoor twee vestigingen op 18,4 en 18,6 km allebei 23 werden en
     de volgorde in de lijst besliste welke de dichtstbijzijnde heette. */
  return 2 * R * Math.asin(Math.sqrt(s)) * 1.25;
}

function pcCoord(pc) {
  const n = parseInt(String(pc).slice(0, 4), 10);
  if (isNaN(n) || n < 1000 || n > 9999) return null;
  const punt = k => {
    const i = (k - 1000) * 4;
    if (PC.charAt(i) === "-") return null;
    const getal = j => PCALF.indexOf(PC.charAt(j)) * 64 + PCALF.indexOf(PC.charAt(j + 1));
    return [PCHOEK[0] + getal(i) / 1000, PCHOEK[1] + getal(i + 2) / 1000];
  };
  const eigen = punt(n);
  if (eigen) return eigen;
  /* Onbekende postcode: het midden van het driecijferige blok eromheen,
     ongeveer tien kilometer breed. Kent de bron ook dat blok niet, dan geven we
     null terug zodat de zoeker het eerlijk kan melden. De oude tabel koos hier
     stilzwijgend de numeriek dichtstbijzijnde sleutel; zo belandde elke
     11xx-postcode op Amsterdam-Centrum, zeventien kilometer van Amstelveen. */
  const blok = Math.floor(n / 10) * 10;
  const buren = [];
  for (let k = blok; k < blok + 10; k++) {
    const p = punt(k);
    if (p) buren.push(p);
  }
  if (!buren.length) return null;
  return [buren.reduce((s, p) => s + p[0], 0) / buren.length,
          buren.reduce((s, p) => s + p[1], 0) / buren.length];
}

let kaart3d = null;

/* Eén bouwer voor twee scenes: de hero (draait vanzelf) en de scrollrit
   (de voortgang wordt door de paginascroll bepaald). */
function maakWasScene(canvas) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x07132e, 26, 82);
  const cam = new THREE.PerspectiveCamera(31, 1, 0.1, 200);
  const rend = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  rend.setPixelRatio(Math.min(devicePixelRatio, 2));
  rend.shadowMap.enabled = true;
  rend.shadowMap.type = THREE.PCFSoftShadowMap;

  const M = (kleur, ruw, met) => new THREE.MeshStandardMaterial({ color: kleur, roughness: ruw, metalness: met });
  const navy = M(0x14306e, 0.42, 0.55), navyD = M(0x0d1f47, 0.55, 0.45);
  const geel = M(0xffb400, 0.38, 0.35), grijs = M(0x9fb0c8, 0.35, 0.7);
  const zwart = M(0x141a26, 0.85, 0.1), wit = M(0xeef2f8, 0.5, 0.15);
  const glas = new THREE.MeshStandardMaterial({ color: 0x8fd0ff, roughness: 0.08, metalness: 0.9,
                                                transparent: true, opacity: 0.55 });

  /* ---- truck ---- */
  const truck = new THREE.Group();
  const doos = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    truck.add(m); return m;
  };
  doos(2.5, 2.0, 2.5, navy, 1.25, 2.05, 0);
  doos(2.5, 0.75, 2.35, glas, 1.30, 2.72, 0);
  doos(0.35, 0.9, 2.4, navyD, 0.06, 1.35, 0);
  doos(2.5, 0.16, 2.6, geel, 1.25, 3.14, 0);
  doos(0.12, 0.62, 0.2, zwart, 0.28, 2.78, 1.42);
  doos(0.12, 0.62, 0.2, zwart, 0.28, 2.78, -1.42);
  doos(0.5, 0.22, 0.5, grijs, 0.55, 3.32, 0.75);
  doos(0.28, 0.28, 2.2, zwart, -0.12, 0.72, 0);
  doos(2.4, 0.28, 2.5, geel, 1.3, 1.02, 0);
  doos(3.9, 0.5, 2.1, zwart, 2.1, 0.85, 0);
  doos(0.9, 0.7, 0.55, grijs, 3.0, 1.35, 0.95);
  doos(0.9, 0.7, 0.55, grijs, 3.0, 1.35, -0.95);

  const zijCv = document.createElement("canvas");
  zijCv.width = 1200; zijCv.height = 360;
  const zc = zijCv.getContext("2d");
  zc.fillStyle = "#eef2f8"; zc.fillRect(0, 0, 1200, 360);
  zc.fillStyle = "#11255d";
  zc.font = "800 132px Archivo, Arial Black, sans-serif";
  zc.textBaseline = "middle";
  zc.fillText("TRUCKWASH", 96, 176);
  const br = zc.measureText("TRUCKWASH").width;
  zc.fillStyle = "#ffb400"; zc.fillRect(110 + br, 110, 122, 132);
  zc.fillStyle = "#11255d"; zc.fillText("1", 148 + br, 178);
  zc.fillStyle = "#5b6880"; zc.font = "500 40px Barlow, Arial, sans-serif";
  zc.fillText("truckwash1group.nl", 100, 272);
  const zijMat = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(zijCv), roughness: 0.5, metalness: 0.12 });
  const opl = new THREE.Mesh(new THREE.BoxGeometry(9.6, 2.9, 2.5), [wit, wit, wit, wit, zijMat, zijMat]);
  opl.position.set(9.3, 2.65, 0); opl.castShadow = true; opl.receiveShadow = true;
  truck.add(opl);
  doos(9.6, 0.34, 2.54, geel, 9.3, 1.42, 0);
  doos(0.12, 2.9, 2.5, navy, 4.45, 2.65, 0);
  doos(3.4, 0.45, 2.0, zwart, 12.4, 0.95, 0);

  const wielen = [];
  const band = new THREE.CylinderGeometry(0.56, 0.56, 0.36, 22);
  const velg = new THREE.CylinderGeometry(0.30, 0.30, 0.38, 18);
  [[0.95, 1.16], [3.05, 1.16], [3.95, 1.16], [11.6, 1.16], [12.6, 1.16], [13.6, 1.16]].forEach(([x, z]) => {
    [z, -z].forEach(zz => {
      const b = new THREE.Mesh(band, zwart); b.rotation.x = Math.PI / 2;
      b.position.set(x, 0.56, zz); b.castShadow = true; truck.add(b); wielen.push(b);
      const v = new THREE.Mesh(velg, grijs); v.rotation.x = Math.PI / 2;
      v.position.set(x, 0.56, zz * 1.03); truck.add(v); wielen.push(v);
    });
  });
  truck.position.x = -7;
  scene.add(truck);

  /* ---- vuillaag ---- */
  const vuilM = new THREE.MeshStandardMaterial({ color: 0x6b6250, roughness: 1, metalness: 0,
                                                 transparent: true, opacity: 0.62 });
  const vuilCab = new THREE.Mesh(new THREE.BoxGeometry(2.56, 2.06, 2.56), vuilM);
  vuilCab.position.set(1.25, 2.05, 0); truck.add(vuilCab);
  const vuilOpl = new THREE.Mesh(new THREE.BoxGeometry(9.66, 2.96, 2.56), vuilM.clone());
  vuilOpl.position.set(9.3, 2.65, 0); truck.add(vuilOpl);

  /* ---- portaal ---- */
  const portaal = new THREE.Group();
  const frameM = M(0x24406f, 0.5, 0.6);
  const staaf = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameM);
    m.position.set(x, y, z); m.castShadow = true; portaal.add(m);
  };
  staaf(0.22, 6.2, 0.22, 0, 3.1, 2.6); staaf(0.22, 6.2, 0.22, 0, 3.1, -2.6);
  staaf(0.22, 0.22, 5.4, 0, 6.15, 0);
  const borstelM = new THREE.MeshStandardMaterial({ color: 0x2f6ad0, roughness: 0.95, metalness: 0 });
  const borstels = [];
  [2.05, -2.05].forEach(z => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 4.4, 16), borstelM);
    b.position.set(0, 2.6, z); b.castShadow = true; portaal.add(b); borstels.push(b);
  });
  const dak = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 4.2, 16), borstelM);
  dak.rotation.x = Math.PI / 2; dak.position.set(0, 5.1, 0); portaal.add(dak); borstels.push(dak);
  scene.add(portaal);

  /* ---- schuim ---- */
  const N = 620;
  const pos = new Float32Array(N * 3), snel = new Float32Array(N * 3);
  const herstart = i => {
    pos[i*3]   = (Math.random() - 0.5) * 1.4;
    pos[i*3+1] = 0.6 + Math.random() * 4.6;
    pos[i*3+2] = (Math.random() - 0.5) * 5.2;
    snel[i*3]   = (Math.random() - 0.5) * 0.03;
    snel[i*3+1] = -0.012 - Math.random() * 0.03;
    snel[i*3+2] = (Math.random() - 0.5) * 0.03;
  };
  for (let i = 0; i < N; i++) herstart(i);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const cv = document.createElement("canvas"); cv.width = cv.height = 64;
  const cx = cv.getContext("2d");
  const gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,.95)");
  gr.addColorStop(0.4, "rgba(210,232,255,.6)");
  gr.addColorStop(1, "rgba(180,215,255,0)");
  cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
  const schuimMat = new THREE.PointsMaterial({
    size: 0.3, map: new THREE.CanvasTexture(cv), transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 });
  const schuim = new THREE.Points(geo, schuimMat);
  scene.add(schuim);

  /* ---- vloer en licht ---- */
  const vloer = new THREE.Mesh(new THREE.PlaneGeometry(120, 70),
    new THREE.MeshStandardMaterial({ color: 0x081228, roughness: 0.72, metalness: 0.18 }));
  vloer.rotation.x = -Math.PI / 2; vloer.receiveShadow = true; scene.add(vloer);

  scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x060d1e, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(9, 15, 11); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -24; key.shadow.camera.right = 24;
  key.shadow.camera.top = 24; key.shadow.camera.bottom = -24;
  key.shadow.camera.updateProjectionMatrix();
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffb400, 0.62);
  rim.position.set(-13, 9, -9);
  scene.add(rim);
  const vul = new THREE.PointLight(0x3f7bff, 1.5, 44); vul.position.set(0, 4.5, 7); scene.add(vul);

  function maat() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    rend.setSize(r.width, r.height, false);
    cam.aspect = r.width / r.height;
    cam.updateProjectionMatrix();
    return true;
  }
  addEventListener("resize", maat);

  function beweegSchuim(dt, sterkte) {
    const stap = dt * 60;
    for (let i = 0; i < N; i++) {
      pos[i*3] += snel[i*3] * stap; pos[i*3+1] += snel[i*3+1] * stap; pos[i*3+2] += snel[i*3+2] * stap;
      if (pos[i*3+1] < 0.15) herstart(i);
    }
    geo.attributes.position.needsUpdate = true;
    schuimMat.opacity = 0.9 * sterkte;
    schuim.visible = sterkte > 0.02;
  }

  return { scene, cam, rend, truck, portaal, borstels, wielen, vuilCab, vuilOpl,
           schuim, beweegSchuim, maat, canvas };
}

/* alleen tekenen als het blok in beeld staat: scheelt accu op een telefoon */
function alsZichtbaar(el, aan, uit) {
  if (!("IntersectionObserver" in window)) { aan(); return; }
  new IntersectionObserver(e => (e[0].isIntersecting ? aan() : uit()), { rootMargin: "120px" }).observe(el);
}

/* ============ HERO ============ */
function bouwHero3D(canvas) {
  if (!window.THREE || canvas.dataset.klaar) return;
  canvas.dataset.klaar = "1";
  const kaal = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const S = maakWasScene(canvas);
  const { cam, rend, scene, truck, portaal, borstels, vuilCab, vuilOpl, schuim } = S;

  let t = 0, sleep = 0, doelSleep = 0, bezig = false, draaien = true;
  canvas.addEventListener("pointerdown", e => { bezig = true; sleep = e.clientX; });
  addEventListener("pointerup", () => { bezig = false; });
  addEventListener("pointermove", e => {
    if (bezig) { doelSleep += (e.clientX - sleep) * 0.006; sleep = e.clientX; }
  });
  alsZichtbaar(canvas, () => { draaien = true; }, () => { draaien = false; });

  let draai = 0, vorige = performance.now();
  function tik() {
    requestAnimationFrame(tik);
    if (!canvas.isConnected) return;
    const nuT = performance.now();
    const dt = Math.min(0.1, (nuT - vorige) / 1000);
    vorige = nuT;
    if (!draaien) return;
    if (canvas.width === 0 && !S.maat()) return;
    const soepel = k => 1 - Math.pow(1 - k, dt * 60);
    t += (kaal ? 0.096 : 0.312) * dt;

    const fase = (Math.sin(t * 0.62) + 1) / 2;
    const px = -8.5 + fase * 20;
    portaal.position.x = px;
    borstels.forEach((b, i) => { if (i === 2) b.rotation.z += 12 * dt; else b.rotation.y += 15.6 * dt; });
    vuilCab.material.opacity = 0.62 * (1 - THREE.MathUtils.clamp((px - truck.position.x - 1) / 3.5, 0, 1));
    vuilOpl.material.opacity = 0.62 * (1 - THREE.MathUtils.clamp((px - truck.position.x - 5) / 9, 0, 1));
    S.beweegSchuim(dt, 1);
    schuim.position.x = px;

    draai += (doelSleep - draai) * soepel(0.06);
    const hoek = 1.02 + Math.sin(t * 0.17) * 0.20 + draai;
    cam.position.set(Math.sin(hoek) * 44, 13.2 + Math.sin(t * 0.3) * 0.8, Math.cos(hoek) * 44);
    cam.lookAt(2.2, 3.1, 0);
    const rct = canvas.getBoundingClientRect();
    cam.setViewOffset(rct.width, rct.height, rct.width > 900 ? -rct.width * 0.19 : 0, 0, rct.width, rct.height);
    rend.render(scene, cam);
  }
  S.maat(); tik();
}

/* ============ SCROLLRIT DOOR DE WASSTRAAT ============ */
function bouwWas3D(canvas) {
  if (!window.THREE || canvas.dataset.klaar) return;
  canvas.dataset.klaar = "1";
  const kaal = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const spoor = canvas.closest(".wasrit").querySelector(".wasrit-spoor");
  const stappen = [...document.querySelectorAll(".wasrit-stap")];
  const balk = document.querySelector(".wasrit-balk span");
  const S = maakWasScene(canvas);
  const { cam, rend, scene, truck, portaal, borstels, wielen, vuilCab, vuilOpl, schuim } = S;

  const mix = (a, b, k) => a + (b - a) * THREE.MathUtils.clamp(k, 0, 1);
  const deel = (p, van, tot) => THREE.MathUtils.clamp((p - van) / (tot - van), 0, 1);
  const zacht = k => k * k * (3 - 2 * k);

  let doelP = 0, p = 0, draaien = true, actief = -1, vorige = performance.now();

  function lees() {
    const r = spoor.getBoundingClientRect();
    const loop = r.height - innerHeight;
    doelP = loop <= 0 ? 0 : THREE.MathUtils.clamp(-r.top / loop, 0, 1);
  }
  addEventListener("scroll", lees, { passive: true });
  addEventListener("resize", lees);
  lees();
  alsZichtbaar(canvas, () => { draaien = true; }, () => { draaien = false; });

  function tik() {
    requestAnimationFrame(tik);
    if (!canvas.isConnected) return;
    const nuT = performance.now();
    const dt = Math.min(0.1, (nuT - vorige) / 1000);
    vorige = nuT;
    if (!draaien) return;
    if (canvas.width === 0 && !S.maat()) return;

    /* de scroll stuurt, maar we lopen er zacht achteraan */
    p += (doelP - p) * (1 - Math.pow(1 - 0.12, dt * 60));

    /* 1. binnenrijden  2. inschuimen  3. borstelen  4. naspoelen en weg */
    const rij = zacht(deel(p, 0, 0.18));
    const weg = zacht(deel(p, 0.86, 1));
    truck.position.x = mix(-24, -7, rij) + weg * 26;

    const veeg = zacht(deel(p, 0.2, 0.8));
    portaal.position.x = truck.position.x + mix(-3.5, 19, veeg);
    schuim.position.x = portaal.position.x;

    const draaisnelheid = deel(p, 0.18, 0.26) * (1 - deel(p, 0.82, 0.92));
    borstels.forEach((b, i) => {
      if (i === 2) b.rotation.z += 12 * dt * draaisnelheid;
      else b.rotation.y += 15.6 * dt * draaisnelheid;
    });
    const rol = truck.position.x;
    wielen.forEach(w => { w.rotation.y = -rol * 1.8; });

    const langs = portaal.position.x - truck.position.x;
    vuilCab.material.opacity = 0.62 * (1 - THREE.MathUtils.clamp((langs - 1) / 3.5, 0, 1));
    vuilOpl.material.opacity = 0.62 * (1 - THREE.MathUtils.clamp((langs - 5) / 9, 0, 1));

    const schuimKracht = Math.min(deel(p, 0.2, 0.3), 1 - deel(p, 0.72, 0.86));
    S.beweegSchuim(dt, Math.max(0, schuimKracht));

    /* Camera. Op een breed scherm zien we de hele combinatie met de tekst links.
       Op een smal staand scherm past een truck van 17 meter simpelweg niet in beeld,
       dus kaderen we daar in op de actie bij het portaal. */
    const rct = canvas.getBoundingClientRect();
    const breed = rct.width > 820;
    const hoek = mix(0.72, 1.42, zacht(p));
    let straal, kijkX, hoog;
    if (breed) {
      straal = mix(54, 45, zacht(deel(p, 0, 0.55))) + weg * 9;
      hoog = mix(10.5, 16, zacht(deel(p, 0.15, 0.95)));
      kijkX = truck.position.x + 5;
    } else {
      straal = mix(34, 30, zacht(deel(p, 0, 0.55))) + weg * 8;
      hoog = mix(8.5, 11.5, zacht(deel(p, 0.15, 0.95)));
      // volg het portaal, want daar gebeurt het; de rest mag buiten beeld vallen
      kijkX = mix(truck.position.x + 3, portaal.position.x - 1.5, deel(p, 0.16, 0.3))
              + weg * 8;
    }
    cam.position.set(Math.sin(hoek) * straal, hoog, Math.cos(hoek) * straal);
    cam.lookAt(kijkX, breed ? 2.8 : 3.1, 0);
    cam.setViewOffset(rct.width, rct.height,
      breed ? -rct.width * 0.17 : 0,          // breed: naar rechts, tekst staat links
      breed ? 0 : rct.height * 0.19,          // smal: omhoog, tekst staat onderaan
      rct.width, rct.height);
    rend.render(scene, cam);

    /* stap markeren */
    const nr = p < 0.2 ? 0 : p < 0.5 ? 1 : p < 0.78 ? 2 : 3;
    if (nr !== actief) {
      actief = nr;
      stappen.forEach((s, i) => s.classList.toggle("aan", i === nr));
    }
    if (balk) balk.style.transform = "scaleX(" + p.toFixed(3) + ")";
  }
  S.maat();
  if (kaal) { doelP = 0.62; p = 0.62; }
  tik();
}

/* ============ KLEINE ANIMATIES ============ */
function onthulBijScroll() {
  if (!("IntersectionObserver" in window)) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const doelen = document.querySelectorAll(".kaart, .band, .infokaart, .vacrij, .faq, .tblwrap, .titem");
  if (!doelen.length) return;
  // pas verbergen als JavaScript er echt is; anders staat alles gewoon zichtbaar
  document.documentElement.classList.add("js-onthul");
  const io = new IntersectionObserver((rijen, obs) => {
    rijen.forEach(r => {
      if (!r.isIntersecting) return;
      r.target.classList.add("zichtbaar");
      obs.unobserve(r.target);
    });
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.05 });
  doelen.forEach((el, i) => {
    el.classList.add("onthul");
    el.style.setProperty("--vertraag", (i % 4) * 60 + "ms");
    io.observe(el);
  });
}

function telOp() {
  if (!("IntersectionObserver" in window)) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const els = document.querySelectorAll(".stat b, .titem b");
  if (!els.length) return;
  const io = new IntersectionObserver((rijen, obs) => {
    rijen.forEach(r => {
      if (!r.isIntersecting) return;
      obs.unobserve(r.target);
      const tekst = r.target.textContent.trim();
      const m = tekst.match(/^(\d+)(?:[.,](\d+))?/);
      if (!m) return;
      const eind = parseFloat(m[0].replace(",", "."));
      const dec = m[2] ? m[2].length : 0;
      const staart = tekst.slice(m[0].length);
      const begin = performance.now();
      const stap = nu => {
        const k = Math.min(1, (nu - begin) / 850);
        const w = 1 - Math.pow(1 - k, 3);
        r.target.textContent = (eind * w).toFixed(dec).replace(".", ",") + staart;
        if (k < 1) requestAnimationFrame(stap);
      };
      requestAnimationFrame(stap);
    });
  }, { threshold: 0.6 });
  els.forEach(e => io.observe(e));
}

/* NLPROV komt uit de echte provinciegrenzen (CBS, via cartomap.github.io),
   geprojecteerd met dezelfde formule als de spelden hieronder. */
const NLPROV=[{"n":"Groningen","r":[[[8.801,-5.504],[8.772,-5.6],[9.238,-6.336],[9.39,-6.888],[9.322,-7.448],[9.341,-7.704],[9.243,-7.776],[9.224,-7.912],[9.282,-8.096],[9.415,-8.384],[9.41,-8.52],[9.356,-8.688],[9.111,-8.744],[9.003,-8.8],[8.855,-8.816],[8.728,-8.936],[8.757,-9.184],[8.477,-9.216],[8.188,-9.352],[8.021,-9.464],[7.839,-9.648],[7.795,-9.968],[7.726,-10.064],[7.766,-10.32],[7.682,-10.4],[7.432,-10.504],[7.353,-10.44],[7.098,-10.528],[6.853,-10.496],[6.548,-10.408],[6.376,-10.304],[6.121,-10.232],[6.077,-10.248],[5.473,-10.176],[5.243,-10.128],[4.938,-9.944],[4.899,-10.0],[4.717,-10.112],[4.634,-10.12],[4.413,-10.064],[4.374,-10.088],[4.344,-10.024],[4.506,-9.712],[4.575,-9.736],[4.663,-9.592],[4.845,-9.528],[4.806,-9.224],[4.683,-9.112],[4.693,-8.968],[4.604,-8.896],[4.506,-8.736],[4.565,-8.544],[4.418,-8.36],[4.305,-8.136],[4.3,-7.88],[4.447,-7.72],[4.722,-7.712],[4.865,-7.6],[5.125,-7.496],[5.316,-8.0],[5.439,-8.224],[5.611,-8.304],[5.635,-8.368],[5.822,-8.432],[6.038,-8.36],[6.126,-8.248],[6.205,-8.064],[6.288,-8.112],[6.322,-7.968],[6.475,-7.856],[6.553,-7.648],[6.848,-7.768],[7.054,-7.752],[8.036,-6.744],[8.423,-6.2],[8.571,-6.128],[8.419,-5.784],[8.541,-5.784],[8.698,-5.56]]]},{"n":"Fryslân","r":[[[4.374,-10.088],[4.305,-10.12],[4.118,-10.032],[3.902,-10.064],[3.515,-10.024],[3.107,-9.904],[2.886,-9.928],[2.749,-9.872],[2.351,-9.648],[2.238,-9.624],[1.409,-9.2],[1.286,-9.08],[1.114,-8.856],[0.898,-8.728],[0.731,-8.56],[0.589,-8.256],[0.511,-7.776],[0.388,-7.664],[0.383,-7.56],[0.241,-7.424],[-0.034,-7.336],[-0.653,-6.792],[-0.015,-7.336],[0.216,-7.392],[0.368,-7.528],[0.457,-7.304],[0.373,-7.24],[0.53,-6.96],[0.476,-6.824],[0.555,-6.512],[0.496,-6.312],[0.525,-6.08],[0.349,-5.992],[0.28,-5.872],[0.324,-5.792],[0.481,-5.656],[0.619,-5.584],[0.756,-5.64],[0.982,-5.568],[1.203,-5.464],[1.311,-5.472],[1.399,-5.592],[1.561,-5.608],[1.694,-5.68],[1.757,-5.552],[1.89,-5.568],[2.027,-5.504],[2.086,-5.552],[2.204,-5.52],[2.43,-5.256],[2.553,-5.336],[2.67,-5.24],[2.827,-5.208],[2.935,-5.264],[3.063,-5.392],[3.093,-5.48],[3.299,-5.536],[3.421,-5.336],[3.696,-5.392],[3.731,-5.408],[3.696,-5.496],[3.834,-5.512],[4.452,-5.928],[4.575,-6.104],[4.698,-6.224],[4.923,-6.2],[5.071,-6.048],[5.365,-6.264],[5.537,-6.576],[5.218,-7.072],[5.243,-7.336],[4.933,-7.448],[4.982,-7.552],[4.865,-7.6],[4.722,-7.712],[4.447,-7.72],[4.3,-7.88],[4.305,-8.136],[4.418,-8.36],[4.565,-8.544],[4.506,-8.736],[4.604,-8.896],[4.693,-8.968],[4.683,-9.112],[4.806,-9.224],[4.845,-9.528],[4.683,-9.584],[4.521,-9.536],[4.506,-9.632],[4.403,-9.624],[4.231,-9.752],[4.197,-9.936],[4.231,-10.064]],[[1.193,-10.312],[0.957,-10.352],[-0.486,-9.96],[-0.663,-9.76],[-0.731,-9.6],[-0.535,-9.584],[-0.388,-9.712],[-0.211,-9.784],[-0.034,-9.76],[0.28,-9.904],[0.412,-10.016],[0.78,-10.04],[0.864,-10.136],[1.183,-10.264]],[[2.116,-10.496],[1.939,-10.496],[1.806,-10.568],[1.728,-10.56],[1.551,-10.424],[1.551,-10.32],[1.684,-10.216],[1.865,-10.2],[1.978,-10.24],[2.111,-10.344],[2.479,-10.304],[2.901,-10.408],[3.097,-10.544],[2.312,-10.48]],[[5.297,-10.856],[5.13,-10.928],[4.855,-10.872],[4.172,-10.776],[4.02,-10.664],[4.001,-10.504],[4.226,-10.576],[4.403,-10.576],[4.673,-10.624],[4.781,-10.712],[5.056,-10.808],[5.095,-10.848]],[[-0.982,-9.208],[-1.158,-9.264],[-1.296,-9.216],[-1.664,-8.968],[-1.802,-8.84],[-2.189,-8.576],[-2.233,-8.464],[-2.116,-8.432],[-2.062,-8.52],[-1.87,-8.528],[-1.576,-8.792],[-1.61,-8.92],[-1.311,-9.048],[-1.163,-9.152]]]},{"n":"Drenthe","r":[[[8.801,-5.504],[8.698,-5.56],[8.541,-5.784],[8.419,-5.784],[8.571,-6.128],[8.423,-6.2],[8.036,-6.744],[7.054,-7.752],[6.848,-7.768],[6.553,-7.648],[6.475,-7.856],[6.322,-7.968],[6.288,-8.112],[6.205,-8.064],[6.126,-8.248],[6.038,-8.36],[5.822,-8.432],[5.635,-8.368],[5.611,-8.304],[5.439,-8.224],[5.316,-8.0],[5.125,-7.496],[4.982,-7.552],[4.933,-7.448],[5.243,-7.336],[5.218,-7.072],[5.537,-6.576],[5.365,-6.264],[5.071,-6.048],[4.923,-6.2],[4.698,-6.224],[4.575,-6.104],[4.452,-5.928],[4.025,-5.632],[4.182,-5.432],[4.168,-5.424],[4.305,-5.312],[4.428,-5.152],[4.202,-4.904],[4.025,-4.8],[4.236,-4.24],[4.334,-4.2],[4.428,-4.28],[4.654,-4.208],[4.776,-4.12],[5.022,-4.16],[5.036,-4.08],[5.223,-3.944],[5.321,-3.696],[5.429,-3.768],[5.66,-3.712],[5.714,-3.792],[5.984,-3.712],[5.959,-3.968],[6.151,-4.128],[6.455,-4.192],[6.912,-3.992],[6.921,-3.824],[7.078,-3.96],[7.25,-4.016],[7.471,-3.984],[7.839,-4.008],[7.947,-3.92],[8.045,-3.904],[8.222,-3.968],[8.551,-3.864],[8.615,-3.952],[8.698,-5.28]]]},{"n":"Overijssel","r":[[[4.182,-5.432],[4.025,-5.632],[3.834,-5.512],[3.696,-5.496],[3.731,-5.408],[3.696,-5.392],[3.421,-5.336],[3.299,-5.536],[3.093,-5.48],[3.063,-5.392],[2.935,-5.264],[2.827,-5.208],[2.67,-5.24],[2.553,-5.336],[2.43,-5.256],[2.548,-5.104],[2.7,-5.08],[2.847,-4.984],[3.053,-4.808],[3.156,-4.52],[3.264,-4.352],[3.112,-4.208],[3.529,-3.944],[3.367,-3.784],[3.23,-3.8],[3.097,-3.712],[2.886,-3.736],[2.665,-3.688],[2.597,-3.496],[2.739,-3.168],[2.764,-2.968],[2.881,-2.936],[2.994,-2.776],[3.073,-2.592],[3.196,-2.672],[3.264,-2.608],[3.475,-2.832],[3.574,-2.88],[3.701,-2.8],[3.785,-2.656],[3.937,-2.528],[3.952,-2.344],[4.02,-2.264],[3.981,-2.064],[4.074,-1.992],[4.045,-1.848],[3.839,-1.776],[3.785,-1.376],[3.848,-1.216],[3.932,-1.208],[3.986,-1.024],[4.074,-0.888],[4.045,-0.808],[4.163,-0.624],[4.334,-0.672],[4.501,-0.608],[5.1,-0.616],[5.095,-0.688],[5.311,-0.768],[5.478,-0.736],[5.542,-0.584],[5.787,-0.264],[5.871,-0.216],[5.979,-0.248],[6.161,-0.216],[6.332,-0.256],[6.44,-0.104],[6.602,-0.192],[6.73,-0.128],[6.745,0.056],[6.691,0.16],[6.951,0.256],[7.633,0.24],[7.721,0.136],[7.766,-0.048],[7.933,-0.224],[8.104,-0.248],[8.291,-0.616],[8.438,-0.6],[8.644,-0.68],[8.669,-0.728],[8.551,-0.848],[8.482,-1.024],[8.473,-1.136],[8.581,-1.36],[8.62,-1.504],[8.698,-1.616],[8.698,-1.784],[8.635,-1.992],[8.522,-2.024],[8.399,-2.232],[8.315,-2.52],[8.237,-2.528],[8.158,-2.36],[8.06,-2.28],[7.668,-2.408],[7.628,-2.48],[7.24,-2.48],[7.132,-2.512],[6.862,-2.688],[6.897,-2.968],[6.779,-3.224],[6.951,-3.192],[7.0,-3.304],[7.132,-3.272],[7.201,-3.312],[6.966,-3.512],[7.005,-3.72],[6.921,-3.824],[6.912,-3.992],[6.455,-4.192],[6.151,-4.128],[5.959,-3.968],[5.984,-3.712],[5.714,-3.792],[5.66,-3.712],[5.429,-3.768],[5.321,-3.696],[5.223,-3.944],[5.036,-4.08],[5.022,-4.16],[4.776,-4.12],[4.654,-4.208],[4.428,-4.28],[4.334,-4.2],[4.236,-4.24],[4.025,-4.8],[4.202,-4.904],[4.428,-5.152],[4.305,-5.312],[4.168,-5.424]]]},{"n":"Flevoland","r":[[[2.43,-5.256],[2.204,-5.52],[2.086,-5.552],[2.027,-5.504],[1.767,-5.424],[1.448,-4.904],[1.438,-4.104],[1.551,-4.008],[1.728,-3.736],[1.61,-3.64],[1.271,-3.536],[0.987,-3.248],[0.766,-3.2],[0.726,-3.08],[0.628,-3.104],[0.687,-3.248],[0.83,-3.36],[0.766,-3.552],[0.491,-3.992],[0.265,-4.224],[0.01,-4.336],[-0.064,-4.328],[0.025,-4.32],[0.295,-4.192],[0.486,-3.992],[0.761,-3.552],[0.82,-3.376],[0.677,-3.24],[0.623,-3.104],[0.619,-3.04],[0.663,-2.888],[0.466,-2.728],[0.383,-2.696],[-0.206,-2.28],[-0.677,-2.0],[-0.839,-1.864],[-0.79,-1.4],[-0.569,-1.48],[-0.388,-1.472],[-0.074,-1.336],[0.064,-1.224],[0.083,-1.232],[0.501,-0.824],[0.834,-0.904],[1.124,-1.0],[1.242,-1.368],[1.242,-1.472],[1.168,-1.6],[1.296,-1.744],[1.541,-1.696],[1.595,-1.84],[1.772,-1.984],[2.062,-2.128],[2.194,-2.12],[2.44,-2.312],[2.538,-2.456],[2.69,-2.744],[2.734,-2.944],[2.739,-3.168],[2.518,-3.416],[2.238,-3.456],[1.743,-3.576],[1.782,-3.704],[2.611,-3.704],[3.259,-3.912],[3.353,-4.064],[3.112,-4.208],[3.264,-4.352],[3.156,-4.52],[3.053,-4.808],[2.847,-4.984],[2.7,-5.08],[2.548,-5.104]]]},{"n":"Gelderland","r":[[[7.172,0.248],[6.951,0.256],[6.691,0.16],[6.745,0.056],[6.73,-0.128],[6.602,-0.192],[6.44,-0.104],[6.332,-0.256],[6.161,-0.216],[5.979,-0.248],[5.871,-0.216],[5.787,-0.264],[5.542,-0.584],[5.478,-0.736],[5.311,-0.768],[5.095,-0.688],[5.1,-0.616],[4.501,-0.608],[4.334,-0.672],[4.163,-0.624],[4.045,-0.808],[4.074,-0.888],[3.986,-1.024],[3.932,-1.208],[3.848,-1.216],[3.785,-1.376],[3.839,-1.776],[4.045,-1.848],[4.074,-1.992],[3.981,-2.064],[4.02,-2.264],[3.952,-2.344],[3.937,-2.528],[3.785,-2.656],[3.701,-2.8],[3.574,-2.88],[3.475,-2.832],[3.264,-2.608],[3.196,-2.672],[3.073,-2.592],[2.994,-2.776],[2.881,-2.936],[2.778,-2.952],[2.656,-2.536],[2.538,-2.456],[2.508,-2.288],[2.16,-1.984],[1.964,-1.848],[1.856,-1.832],[1.733,-1.72],[1.546,-1.704],[1.527,-1.568],[1.355,-1.416],[1.271,-1.288],[1.114,-0.912],[0.839,-0.912],[0.756,-0.832],[0.511,-0.776],[0.457,-0.568],[0.54,-0.552],[0.682,-0.416],[0.687,-0.168],[0.834,-0.128],[0.977,0.024],[0.957,0.224],[0.903,0.352],[0.913,0.448],[0.78,0.56],[0.903,0.64],[1.095,0.576],[1.247,0.4],[1.291,0.576],[1.266,0.808],[1.409,0.952],[1.428,1.176],[1.541,1.28],[1.6,1.408],[1.605,1.584],[1.502,1.656],[1.281,1.56],[1.178,1.464],[0.913,1.328],[0.697,1.312],[0.579,1.384],[0.407,1.448],[0.236,1.456],[0.162,1.544],[-0.147,1.48],[-0.26,1.384],[-0.344,1.392],[-0.461,1.528],[-0.589,1.464],[-0.825,1.88],[-0.918,2.096],[-1.041,2.096],[-1.075,2.192],[-1.203,2.216],[-1.183,2.336],[-1.448,2.336],[-1.473,2.416],[-1.32,2.472],[-1.345,2.648],[-1.473,2.632],[-1.394,2.736],[-1.237,2.816],[-1.144,2.952],[-1.001,2.896],[-0.795,3.016],[-0.795,3.192],[-0.673,3.256],[-0.339,3.272],[-0.221,3.32],[-0.177,3.288],[-0.118,3.28],[0.0,3.304],[0.295,3.112],[0.339,2.88],[0.501,2.632],[0.682,2.72],[0.854,2.68],[0.913,2.568],[1.183,2.672],[1.266,2.576],[1.419,2.56],[1.644,2.64],[1.752,2.816],[1.934,2.896],[1.973,2.976],[2.121,3.024],[2.184,3.128],[2.356,3.184],[2.71,3.128],[2.769,3.136],[2.788,2.992],[2.911,2.976],[3.019,3.176],[3.205,3.216],[3.392,3.072],[3.333,2.816],[3.166,2.608],[3.255,2.504],[3.372,2.552],[3.613,2.456],[3.706,2.384],[3.745,2.28],[3.961,2.416],[4.104,2.424],[4.256,2.472],[4.256,2.304],[4.148,2.24],[4.109,2.112],[3.976,2.04],[4.207,1.96],[4.374,2.064],[4.339,2.136],[4.492,2.256],[4.722,2.256],[4.811,2.208],[4.914,2.28],[4.938,2.408],[5.13,2.392],[5.218,2.52],[5.434,2.576],[5.439,2.368],[5.341,2.304],[5.355,2.216],[5.542,2.28],[5.65,2.28],[5.719,2.36],[5.895,2.256],[6.165,2.144],[6.313,2.048],[6.568,1.968],[6.75,1.872],[6.838,1.88],[6.98,2.032],[7.216,1.872],[7.334,1.72],[7.358,1.528],[7.506,1.488],[7.496,1.248],[7.417,1.216],[7.132,0.976],[6.941,0.88],[6.813,0.88],[6.853,0.64],[7.044,0.6],[7.123,0.52]]]},{"n":"Utrecht","r":[[[-1.154,-1.08],[-1.262,-1.056],[-1.365,-1.216],[-1.487,-1.112],[-1.551,-1.12],[-1.664,-1.024],[-1.836,-1.024],[-1.821,-0.944],[-1.91,-0.824],[-2.111,-0.824],[-2.243,-0.696],[-2.386,-0.616],[-2.479,-0.616],[-2.386,-0.416],[-2.238,-0.24],[-2.003,-0.096],[-2.091,-0.048],[-2.086,0.088],[-2.184,0.104],[-2.292,0.04],[-2.391,0.08],[-2.494,0.224],[-2.332,0.344],[-2.327,0.6],[-2.121,0.696],[-2.312,0.8],[-2.44,1.088],[-2.224,1.056],[-2.175,1.152],[-2.366,1.2],[-2.229,1.4],[-2.16,1.456],[-2.072,1.696],[-1.806,1.616],[-1.772,1.768],[-1.689,1.872],[-1.497,1.984],[-1.478,2.128],[-1.355,2.152],[-1.34,2.328],[-1.183,2.336],[-1.203,2.216],[-1.075,2.192],[-1.041,2.096],[-0.918,2.096],[-0.825,1.88],[-0.589,1.464],[-0.461,1.528],[-0.344,1.392],[-0.26,1.384],[-0.147,1.48],[0.162,1.544],[0.236,1.456],[0.407,1.448],[0.579,1.384],[0.697,1.312],[0.913,1.328],[1.178,1.464],[1.281,1.56],[1.502,1.656],[1.605,1.584],[1.6,1.408],[1.541,1.28],[1.428,1.176],[1.409,0.952],[1.266,0.808],[1.291,0.576],[1.247,0.4],[1.095,0.576],[0.903,0.64],[0.78,0.56],[0.913,0.448],[0.903,0.352],[0.957,0.224],[0.977,0.024],[0.834,-0.128],[0.687,-0.168],[0.682,-0.416],[0.54,-0.552],[0.457,-0.568],[0.511,-0.776],[0.28,-0.96],[-0.167,-1.056],[-0.378,-0.6],[-0.407,-0.448],[-0.525,-0.224],[-0.879,-0.248],[-1.247,-0.128],[-1.306,-0.504],[-1.266,-0.648],[-1.193,-0.696],[-1.34,-0.912],[-1.311,-1.0],[-1.149,-1.048]]]},{"n":"Noord-Holland","r":[[[-0.064,-4.328],[-0.005,-4.424],[-0.059,-4.52],[-0.083,-4.72],[-0.206,-4.824],[-0.525,-4.84],[-0.589,-4.728],[-0.756,-4.736],[-0.962,-4.992],[-0.913,-5.568],[-1.232,-6.192],[-1.281,-6.248],[-0.658,-6.8],[-1.208,-6.328],[-1.63,-6.24],[-1.792,-6.024],[-1.919,-5.952],[-2.086,-5.904],[-2.41,-6.088],[-2.499,-6.288],[-2.445,-6.424],[-2.557,-6.44],[-2.636,-6.52],[-2.793,-6.504],[-2.862,-6.376],[-2.916,-5.8],[-3.107,-5.096],[-3.225,-4.808],[-3.255,-4.632],[-3.25,-4.464],[-3.363,-3.568],[-3.471,-2.904],[-3.559,-2.632],[-3.412,-2.536],[-3.662,-2.488],[-3.623,-2.368],[-3.657,-2.184],[-3.956,-1.424],[-3.613,-1.272],[-3.588,-1.328],[-3.377,-1.312],[-3.495,-1.04],[-3.593,-0.952],[-3.647,-0.552],[-3.421,-0.52],[-3.274,-0.528],[-3.093,-0.648],[-3.014,-0.616],[-2.926,-0.672],[-2.827,-0.656],[-2.823,-0.504],[-2.479,-0.616],[-2.386,-0.616],[-2.243,-0.696],[-2.111,-0.824],[-1.91,-0.824],[-1.821,-0.944],[-1.836,-1.024],[-1.664,-1.024],[-1.551,-1.12],[-1.487,-1.112],[-1.365,-1.216],[-1.262,-1.056],[-1.154,-1.08],[-1.149,-1.048],[-1.311,-1.0],[-1.34,-0.912],[-1.193,-0.696],[-1.266,-0.648],[-1.306,-0.504],[-1.247,-0.128],[-0.879,-0.248],[-0.525,-0.224],[-0.407,-0.448],[-0.378,-0.6],[-0.167,-1.056],[0.029,-1.024],[-0.015,-1.144],[0.069,-1.224],[-0.044,-1.176],[-0.255,-1.296],[-0.506,-1.272],[-0.619,-1.232],[-0.746,-1.32],[-0.795,-1.408],[-1.095,-1.52],[-1.291,-1.472],[-1.301,-1.56],[-1.424,-1.624],[-1.6,-1.776],[-1.404,-1.88],[-1.217,-2.104],[-1.144,-2.104],[-1.104,-2.232],[-1.021,-2.296],[-1.006,-2.384],[-0.82,-2.48],[-0.967,-2.536],[-1.016,-2.416],[-1.016,-2.32],[-1.046,-2.296],[-1.232,-2.312],[-1.237,-2.44],[-1.139,-2.576],[-1.183,-2.688],[-1.05,-2.832],[-1.149,-2.984],[-1.203,-3.16],[-1.32,-3.336],[-1.374,-3.568],[-1.379,-3.84],[-1.247,-3.936],[-1.139,-3.88],[-1.036,-3.944],[-0.844,-3.76],[-0.692,-3.784],[-0.614,-3.864],[-0.496,-3.888],[-0.314,-4.056],[-0.265,-4.288]],[[-2.067,-8.056],[-2.155,-8.264],[-2.253,-8.264],[-2.661,-7.648],[-2.827,-7.344],[-2.901,-6.976],[-2.877,-6.776],[-2.764,-6.712],[-2.528,-6.816],[-2.361,-7.032],[-2.224,-7.072],[-2.096,-7.24],[-2.096,-7.32],[-1.978,-7.432],[-1.964,-7.8],[-1.924,-7.88]]]},{"n":"Zuid-Holland","r":[[[-2.479,-0.616],[-2.823,-0.504],[-2.827,-0.656],[-2.926,-0.672],[-3.014,-0.616],[-3.093,-0.648],[-3.274,-0.528],[-3.421,-0.52],[-3.647,-0.552],[-3.593,-0.952],[-3.495,-1.04],[-3.377,-1.312],[-3.588,-1.328],[-3.613,-1.272],[-3.956,-1.424],[-4.187,-0.936],[-4.546,-0.296],[-4.752,-0.0],[-5.1,0.376],[-5.709,1.12],[-5.925,1.32],[-6.151,1.248],[-6.175,1.312],[-6.362,1.288],[-6.46,1.32],[-6.553,1.464],[-6.563,1.568],[-6.46,1.856],[-6.386,1.88],[-6.185,1.808],[-6.121,1.856],[-6.239,2.112],[-6.048,2.408],[-6.205,2.608],[-6.381,2.408],[-6.637,2.48],[-6.828,2.584],[-6.912,2.592],[-7.069,2.688],[-7.093,2.776],[-7.044,2.944],[-7.069,3.032],[-7.172,3.136],[-7.157,3.152],[-7.093,3.136],[-7.024,2.952],[-6.892,2.92],[-6.887,2.848],[-6.696,2.816],[-6.632,2.776],[-6.435,2.784],[-6.283,2.968],[-6.298,3.152],[-6.273,3.256],[-6.092,3.504],[-6.038,3.536],[-5.837,3.536],[-5.621,3.624],[-5.611,3.744],[-5.454,3.736],[-5.301,3.808],[-5.243,3.912],[-5.002,3.96],[-4.717,3.88],[-4.629,3.832],[-4.575,3.72],[-4.398,3.608],[-4.388,3.424],[-4.226,3.472],[-4.089,3.48],[-3.78,3.592],[-3.495,3.504],[-3.343,3.416],[-3.255,3.464],[-3.068,3.408],[-2.764,3.152],[-2.675,2.944],[-2.582,2.856],[-2.469,2.8],[-2.229,2.808],[-2.018,2.648],[-1.787,2.576],[-1.345,2.648],[-1.32,2.472],[-1.473,2.416],[-1.448,2.336],[-1.34,2.328],[-1.355,2.152],[-1.478,2.128],[-1.497,1.984],[-1.689,1.872],[-1.772,1.768],[-1.806,1.616],[-2.072,1.696],[-2.16,1.456],[-2.229,1.4],[-2.366,1.2],[-2.175,1.152],[-2.224,1.056],[-2.44,1.088],[-2.312,0.8],[-2.121,0.696],[-2.327,0.6],[-2.332,0.344],[-2.494,0.224],[-2.391,0.08],[-2.292,0.04],[-2.184,0.104],[-2.086,0.088],[-2.091,-0.048],[-2.003,-0.096],[-2.238,-0.24],[-2.386,-0.416]]]},{"n":"Zeeland","r":[[[-7.157,3.152],[-7.172,3.136],[-7.299,3.272],[-7.54,3.256],[-7.805,3.352],[-7.908,3.44],[-7.957,3.544],[-7.908,3.776],[-7.746,3.896],[-7.785,4.064],[-7.864,4.088],[-7.937,4.216],[-7.947,4.4],[-8.178,4.488],[-8.35,4.448],[-8.581,4.48],[-9.14,4.864],[-9.165,4.976],[-9.032,5.12],[-8.855,5.248],[-8.703,5.496],[-8.468,5.688],[-8.149,5.648],[-8.06,5.544],[-7.893,5.648],[-7.751,5.792],[-7.682,5.912],[-7.584,5.88],[-7.412,6.0],[-7.304,6.112],[-7.078,6.072],[-6.99,6.024],[-6.867,6.04],[-6.745,5.728],[-6.769,5.64],[-6.504,5.504],[-6.219,5.744],[-6.136,5.76],[-6.077,5.888],[-5.856,5.976],[-5.611,6.04],[-5.414,5.944],[-5.243,6.04],[-5.189,6.2],[-5.022,6.192],[-5.066,6.128],[-5.085,5.872],[-5.027,5.8],[-5.306,5.16],[-5.223,4.856],[-5.262,4.688],[-5.439,4.448],[-5.439,4.328],[-5.331,4.176],[-5.218,4.128],[-5.395,4.088],[-5.552,3.968],[-5.621,3.736],[-5.846,3.776],[-5.93,3.864],[-6.165,3.72],[-6.308,3.704],[-6.347,3.576],[-6.47,3.456],[-6.514,3.336],[-6.804,3.352],[-6.931,3.248],[-7.118,3.296],[-7.236,3.288]],[[-8.743,5.944],[-9.13,6.096],[-9.174,6.064],[-9.474,6.224],[-9.454,6.408],[-9.4,6.528],[-9.533,6.68],[-9.44,6.784],[-9.474,6.864],[-9.292,7.144],[-9.081,7.264],[-8.698,7.232],[-8.762,6.904],[-8.527,6.832],[-8.463,6.896],[-8.389,6.768],[-8.144,6.896],[-8.06,6.88],[-7.883,6.992],[-7.579,7.048],[-7.388,7.152],[-7.417,7.232],[-7.407,7.488],[-7.26,7.528],[-7.069,7.512],[-6.926,7.416],[-6.941,7.6],[-6.583,7.472],[-6.352,7.264],[-6.2,7.232],[-6.097,7.256],[-5.567,6.856],[-5.228,6.416],[-5.37,6.208],[-5.532,6.216],[-5.699,6.312],[-5.827,6.312],[-6.121,6.272],[-6.293,5.992],[-6.509,5.944],[-6.538,6.112],[-6.602,6.264],[-6.789,6.312],[-7.034,6.512],[-7.329,6.496],[-7.417,6.4],[-7.741,6.4],[-7.918,6.232],[-8.144,6.192],[-8.419,6.096],[-8.6,5.96]]]},{"n":"Noord-Brabant","r":[[[2.769,3.136],[2.71,3.128],[2.356,3.184],[2.184,3.128],[2.121,3.024],[1.973,2.976],[1.934,2.896],[1.752,2.816],[1.644,2.64],[1.419,2.56],[1.266,2.576],[1.183,2.672],[0.913,2.568],[0.854,2.68],[0.682,2.72],[0.501,2.632],[0.339,2.88],[0.295,3.112],[0.0,3.304],[-0.118,3.28],[-0.177,3.288],[-0.221,3.32],[-0.339,3.272],[-0.673,3.256],[-0.795,3.192],[-0.795,3.016],[-1.001,2.896],[-1.144,2.952],[-1.237,2.816],[-1.394,2.736],[-1.473,2.632],[-1.787,2.576],[-2.018,2.648],[-2.229,2.808],[-2.469,2.8],[-2.582,2.856],[-2.675,2.944],[-2.764,3.152],[-3.068,3.408],[-3.259,3.464],[-3.426,3.624],[-3.794,3.72],[-3.976,3.736],[-4.29,3.624],[-4.398,3.608],[-4.447,3.648],[-4.477,3.848],[-4.663,4.016],[-4.825,4.032],[-5.218,4.128],[-5.331,4.176],[-5.439,4.328],[-5.439,4.448],[-5.262,4.688],[-5.223,4.856],[-5.306,5.16],[-5.027,5.8],[-5.085,5.872],[-5.066,6.128],[-5.022,6.192],[-4.737,6.176],[-4.708,6.336],[-4.492,6.368],[-4.31,6.28],[-4.261,6.2],[-4.457,5.936],[-4.433,5.664],[-4.492,5.608],[-4.212,5.448],[-3.991,5.384],[-3.74,5.344],[-3.691,5.416],[-3.78,5.6],[-3.755,5.816],[-3.559,5.736],[-3.289,5.792],[-3.093,5.792],[-3.107,5.648],[-2.98,5.584],[-2.803,5.328],[-2.685,5.2],[-2.381,5.24],[-2.351,5.336],[-2.258,5.368],[-2.278,5.512],[-2.341,5.608],[-2.312,5.816],[-2.518,5.736],[-2.616,5.752],[-2.597,5.88],[-2.508,5.928],[-2.258,5.88],[-2.032,5.864],[-1.821,6.032],[-1.654,5.824],[-1.453,5.64],[-1.419,5.424],[-1.365,5.344],[-1.247,5.432],[-1.085,5.432],[-0.957,5.752],[-1.124,6.056],[-0.898,6.312],[-0.825,6.424],[-0.815,6.672],[-0.673,6.72],[-0.491,6.616],[-0.285,6.76],[-0.363,7.056],[-0.304,7.112],[-0.182,7.064],[-0.02,7.112],[0.177,7.096],[0.226,6.992],[0.574,7.104],[0.697,6.944],[0.81,6.92],[0.908,6.8],[1.06,6.84],[1.266,7.104],[1.252,7.248],[1.306,7.432],[1.566,7.368],[1.6,7.008],[1.826,6.68],[2.823,6.376],[3.097,6.12],[2.808,5.6],[2.754,5.264],[2.715,5.168],[2.641,4.672],[2.901,4.72],[2.98,4.784],[3.117,4.768],[3.456,4.64],[3.593,4.784],[3.632,4.544],[3.564,4.432],[3.534,4.224],[3.299,4.032],[3.255,3.944],[3.264,3.792],[3.215,3.528],[3.112,3.472],[2.945,3.44],[2.872,3.376],[2.847,3.2]]]},{"n":"Limburg","r":[[[3.205,3.216],[3.019,3.176],[2.911,2.976],[2.788,2.992],[2.769,3.136],[2.847,3.2],[2.872,3.376],[2.945,3.44],[3.112,3.472],[3.215,3.528],[3.264,3.792],[3.255,3.944],[3.299,4.032],[3.534,4.224],[3.564,4.432],[3.632,4.544],[3.593,4.784],[3.456,4.64],[3.117,4.768],[2.98,4.784],[2.901,4.72],[2.641,4.672],[2.715,5.168],[2.754,5.264],[2.808,5.6],[3.097,6.12],[2.823,6.376],[1.826,6.68],[1.6,7.008],[1.566,7.368],[1.306,7.432],[1.698,7.6],[1.757,7.72],[2.003,7.744],[2.16,7.704],[2.292,7.728],[2.346,7.992],[2.572,7.856],[2.631,7.968],[2.729,8.04],[2.651,8.152],[2.503,8.256],[2.621,8.4],[2.572,8.464],[2.43,8.48],[2.474,8.584],[2.42,8.728],[2.317,8.72],[2.248,8.928],[2.337,9.024],[2.287,9.216],[2.062,9.504],[2.238,9.536],[2.091,9.832],[2.086,9.912],[1.954,9.92],[1.88,10.088],[1.689,10.232],[1.664,10.432],[1.748,10.608],[1.934,10.704],[1.949,11.0],[1.88,11.112],[1.939,11.16],[2.062,11.08],[2.155,11.144],[2.194,11.04],[2.341,10.936],[2.489,11.152],[2.675,11.08],[2.764,11.088],[2.877,11.04],[2.896,11.152],[3.048,11.192],[3.097,11.144],[3.284,11.112],[3.309,11.16],[3.539,11.168],[3.574,11.008],[3.313,10.816],[3.363,10.72],[3.456,10.792],[3.559,10.688],[3.515,10.528],[3.529,10.432],[3.814,10.312],[3.868,10.224],[3.804,10.056],[3.839,9.824],[3.524,9.72],[3.52,9.336],[3.269,9.36],[3.215,9.296],[2.931,9.4],[2.975,9.184],[2.842,9.056],[2.837,8.896],[2.881,8.784],[3.009,8.664],[3.132,8.92],[3.284,8.824],[3.289,8.712],[3.485,8.472],[3.613,8.424],[3.809,8.248],[3.888,8.12],[4.055,8.04],[4.236,8.008],[4.295,7.936],[4.118,7.816],[4.325,7.712],[4.246,7.648],[3.991,7.8],[3.839,7.824],[3.794,7.736],[3.77,7.432],[3.858,7.416],[3.794,7.256],[3.858,7.216],[4.05,7.0],[4.266,6.536],[4.369,6.488],[4.546,6.32],[4.487,6.08],[4.442,6.0],[4.536,5.4],[4.482,5.272],[4.477,5.096],[4.418,4.984],[4.305,4.888],[4.207,4.664],[4.079,4.552],[4.03,4.456],[3.883,4.352],[4.01,3.944],[3.868,3.92],[3.618,3.816],[3.564,3.528],[3.657,3.464],[3.407,3.296],[3.215,3.296]]]}];

const KAART_LAT_C = 52.15, KAART_LON_C = 5.30, KAART_K = 8.0;

const kx = lon => (lon - KAART_LON_C) * Math.cos(KAART_LAT_C * Math.PI / 180) * KAART_K;

const kz = lat => -(lat - KAART_LAT_C) * KAART_K;

function bouwKaart3D(canvas, locs, opKlik) {
  if (!window.THREE || canvas.dataset.klaar) return;
  canvas.dataset.klaar = "1";
  const kaal = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const houder = canvas.parentElement;
  const label = houder.querySelector(".kaartlabel");

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(34, 1, 0.1, 400);
  const rend = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  rend.setPixelRatio(Math.min(devicePixelRatio, 2));
  rend.shadowMap.enabled = true;
  rend.shadowMap.type = THREE.PCFSoftShadowMap;

  const wereld = new THREE.Group();
  scene.add(wereld);

  /* ---- provincies ---- */
  const TINTEN = [0x1b3d8f, 0x1f4499, 0x18378a, 0x224aa2, 0x1c3f93, 0x203f96];
  const provincies = [];
  NLPROV.forEach((prov, pi) => {
    const groep = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: TINTEN[pi % TINTEN.length], roughness: 0.66, metalness: 0.28,
    });
    prov.r.forEach(ring => {
      const vorm = new THREE.Shape();
      ring.forEach(([x, z], i) => (i ? vorm.lineTo(x, -z) : vorm.moveTo(x, -z)));
      vorm.closePath();
      const geo = new THREE.ExtrudeGeometry(vorm, {
        depth: 0.85, bevelEnabled: true, bevelSize: 0.07, bevelThickness: 0.07, bevelSegments: 1,
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.castShadow = true; m.receiveShadow = true;
      groep.add(m);
      const rand = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 32),
        new THREE.LineBasicMaterial({ color: 0x86aaff, transparent: true, opacity: 0.42 }));
      rand.rotation.x = -Math.PI / 2;
      rand.position.y = 0.004;
      groep.add(rand);
    });
    groep.userData = { mat, naam: prov.n, doelY: 0, vertraging: pi * 0.055 };
    groep.position.y = kaal ? 0 : -7;
    wereld.add(groep);
    provincies.push(groep);
  });

  /* ---- water eronder ---- */
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    new THREE.MeshStandardMaterial({ color: 0x081a3e, roughness: 0.35, metalness: 0.55 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.55;
  water.receiveShadow = true;
  wereld.add(water);

  /* ---- spelden ---- */
  const spelden = [];
  const speldGeo = new THREE.ConeGeometry(0.30, 1.15, 7);
  const bolGeo = new THREE.SphereGeometry(0.27, 16, 12);
  const ringGeo = new THREE.RingGeometry(0.42, 0.58, 24);
  locs.forEach((l, i) => {
    if (l.lat == null) return;
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffb400, roughness: 0.28, metalness: 0.45,
      emissive: 0x3a2500, emissiveIntensity: 0.45,
    });
    const kegel = new THREE.Mesh(speldGeo, mat);
    kegel.rotation.x = Math.PI; kegel.position.y = 0.58; kegel.castShadow = true;
    const bol = new THREE.Mesh(bolGeo, mat);
    bol.position.y = 1.28; bol.castShadow = true;
    const puls = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xffc94a, transparent: true, opacity: 0, side: THREE.DoubleSide }));
    puls.rotation.x = -Math.PI / 2; puls.position.y = 0.92;
    g.add(kegel, bol, puls);
    g.position.set(kx(l.lng), 0.85, kz(l.lat));
    g.userData = { i, mat, puls, basis: 0.85, val: kaal ? 0 : 10 + i * 0.4, loc: l };
    g.scale.setScalar(kaal ? 1 : 0.001);
    wereld.add(g);
    spelden.push(g);
  });

  /* ---- licht ---- */
  scene.add(new THREE.HemisphereLight(0xc3d8ff, 0x050c1c, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(13, 26, 11);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 70 });
  key.shadow.camera.updateProjectionMatrix();
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffb400, 0.7);
  rim.position.set(-14, 9, -13);
  scene.add(rim);

  /* ---- bediening ---- */
  const ELEV = 0.88;               // kijkhoek boven de horizon, ongeveer 50 graden
  let PAS = 46, MIN_Z = 30, MAX_Z = 80;
  let draai = 0.34, draaiDoel = 0.34, vaart = 0;
  let zoom = 90, zoomDoel = 46;
  let hover = -1, gekozen = -1, t = 0, intro = 0;
  let laatsteActie = 0;

  const straal = new THREE.Raycaster();
  const muis = new THREE.Vector2(9, 9);
  let sleepX = null, sleepActief = false;

  const nu = () => performance.now();
  const raakte = () => { laatsteActie = nu(); };

  // straal van het land, zodat de kaart altijd netjes in beeld past
  const doos = new THREE.Box3();
  provincies.forEach(p => p.children.forEach(m => {
    if (m.isMesh) { m.geometry.computeBoundingBox(); doos.expandByObject(m); }
  }));
  const midden = doos.getCenter(new THREE.Vector3());
  const maten = doos.getSize(new THREE.Vector3());
  const R = Math.max(maten.x, maten.z) / 2 * 1.08;
  water.scale.setScalar(R * 1.55);
  water.position.set(midden.x, -0.55, midden.z);

  function maat() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    rend.setSize(r.width, r.height, false);
    cam.aspect = r.width / r.height;
    cam.updateProjectionMatrix();
    // afstand waarop het land precies past, verticaal en horizontaal
    const halfV = Math.tan((cam.fov * Math.PI / 180) / 2);
    const halfH = halfV * cam.aspect;
    PAS = R / Math.min(halfV, halfH) * 1.12;
    MIN_Z = PAS * 0.62;
    MAX_Z = PAS * 1.9;
    zoomDoel = Math.min(MAX_Z, Math.max(MIN_Z, zoomDoel === 46 ? PAS : zoomDoel));
  }
  addEventListener("resize", maat);

  /* muis */
  canvas.addEventListener("pointermove", e => {
    if (e.pointerType === "touch") return;
    const r = canvas.getBoundingClientRect();
    muis.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    muis.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    if (sleepActief && sleepX !== null) {
      const d = (e.clientX - sleepX) * 0.0075;
      draaiDoel += d; vaart = d; sleepX = e.clientX; raakte();
    }
  });
  canvas.addEventListener("pointerdown", e => {
    if (e.pointerType === "touch") return;
    sleepActief = true; sleepX = e.clientX; vaart = 0; raakte();
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  });
  addEventListener("pointerup", () => { sleepActief = false; sleepX = null; });
  canvas.addEventListener("pointerleave", () => { muis.set(9, 9); });
  canvas.addEventListener("click", () => { if (hover >= 0) opKlik(hover); });

  /* scrollwiel: zoomt de kaart, maar blokkeert de pagina niet als we aan de grens zitten */
  canvas.addEventListener("wheel", e => {
    const richting = Math.sign(e.deltaY);
    const grens = (richting > 0 && zoomDoel >= MAX_Z - 0.5) || (richting < 0 && zoomDoel <= MIN_Z + 0.5);
    if (grens) return;                    // laat de pagina verder scrollen
    e.preventDefault();
    zoomDoel = Math.min(MAX_Z, Math.max(MIN_Z, zoomDoel + richting * PAS * 0.09));
    raakte();
  }, { passive: false });

  /* aanraking: verticaal vegen scrollt de pagina, horizontaal draait de kaart,
     twee vingers knijpen zoomt. Zo blijft de pagina op een telefoon bruikbaar. */
  let tStart = null, tModus = null, knijpAf = 0;
  const afstand = tl => Math.hypot(tl[0].clientX - tl[1].clientX, tl[0].clientY - tl[1].clientY);

  canvas.addEventListener("touchstart", e => {
    if (e.touches.length === 1) {
      tStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      tModus = null;
    } else if (e.touches.length === 2) {
      tModus = "knijp"; knijpAf = afstand(e.touches); raakte();
    }
  }, { passive: true });

  canvas.addEventListener("touchmove", e => {
    if (e.touches.length === 2 && tModus === "knijp") {
      e.preventDefault();
      const d = afstand(e.touches);
      zoomDoel = Math.min(MAX_Z, Math.max(MIN_Z, zoomDoel * (knijpAf / (d || 1))));
      knijpAf = d; raakte();
      return;
    }
    if (e.touches.length !== 1 || !tStart) return;
    const dx = e.touches[0].clientX - tStart.x;
    const dy = e.touches[0].clientY - tStart.y;
    if (tModus === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      tModus = Math.abs(dx) > Math.abs(dy) * 1.2 ? "draai" : "scroll";
    }
    if (tModus !== "draai") return;       // pagina mag gewoon scrollen
    e.preventDefault();
    const d = dx * 0.009;
    draaiDoel += d; vaart = d;
    tStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    raakte();
  }, { passive: false });

  canvas.addEventListener("touchend", () => { tStart = null; tModus = null; }, { passive: true });

  /* toetsenbord */
  canvas.addEventListener("keydown", e => {
    const stap = 0.22;
    if (e.key === "ArrowLeft") { draaiDoel -= stap; }
    else if (e.key === "ArrowRight") { draaiDoel += stap; }
    else if (e.key === "+" || e.key === "=") { zoomDoel = Math.max(MIN_Z, zoomDoel - PAS * 0.12); }
    else if (e.key === "-" || e.key === "_") { zoomDoel = Math.min(MAX_Z, zoomDoel + PAS * 0.12); }
    else if (e.key === "Home") { draaiDoel = 0.34; zoomDoel = PAS; }
    else return;
    e.preventDefault(); raakte();
  });

  kaart3d = {
    kies(i) { gekozen = i; },
    zoomIn() { zoomDoel = Math.max(MIN_Z, zoomDoel - PAS * 0.14); raakte(); },
    zoomUit() { zoomDoel = Math.min(MAX_Z, zoomDoel + PAS * 0.14); raakte(); },
    herstel() { draaiDoel = 0.34; zoomDoel = PAS; vaart = 0; raakte(); },
    naar(i) {
      gekozen = i;
      const g = spelden.find(s => s.userData.i === i);
      if (!g) return;
      draaiDoel = Math.atan2(g.position.x - midden.x, g.position.z - midden.z + R * 1.6) * 0.8;
      zoomDoel = Math.max(MIN_Z, PAS * 0.78); raakte();
    },
  };

  /* ---- tekenen ---- */
  const scherm = new THREE.Vector3();
  let vorigeTijd = performance.now();
  function tik() {
    requestAnimationFrame(tik);
    if (!canvas.isConnected) { kaart3d = null; return; }
    if (canvas.width === 0) maat();
    // alles op de klok, niet op het aantal beeldjes: even snel op 60 als op 120 Hz,
    // en een trage of geminimaliseerde tab loopt niet achter
    const nuT = performance.now();
    const dt = Math.min(0.1, (nuT - vorigeTijd) / 1000);
    vorigeTijd = nuT;
    const soepel = k => 1 - Math.pow(1 - k, dt * 60);
    t += (kaal ? 0.12 : 0.5) * dt;
    intro = Math.min(1, intro + (kaal ? 1 : dt / 1.5));

    /* provincies komen omhoog */
    provincies.forEach(p => {
      const v = Math.min(1, Math.max(0, (intro - p.userData.vertraging) / 0.5));
      const e = 1 - Math.pow(1 - v, 3);
      p.position.y = -7 + 7 * e;
    });

    /* spelden vallen in */
    spelden.forEach((g, k) => {
      const v = Math.min(1, Math.max(0, (intro - 0.45 - k * 0.022) / 0.4));
      const e = 1 - Math.pow(1 - v, 4);
      g.scale.setScalar(Math.max(0.001, e));
      const aan = g.userData.i === hover || g.userData.i === gekozen;
      const zweef = Math.sin(t * 1.5 + k * 0.7) * 0.07;
      const doel = g.userData.basis + zweef + (aan ? 1.15 : 0) + (1 - e) * 9;
      g.position.y += (doel - g.position.y) * soepel(0.18);
      g.userData.mat.color.set(aan ? 0xffffff : 0xffb400);
      g.userData.mat.emissiveIntensity = aan ? 1.15 : 0.45;
      const p = g.userData.puls;
      if (aan) {
        const f = (t * 0.9) % 1;
        p.scale.setScalar(1 + f * 1.6);
        p.material.opacity = 0.55 * (1 - f);
      } else {
        p.material.opacity = 0;
      }
    });

    /* traagheid en zachte automatische draai als niemand iets doet */
    if (!sleepActief && tModus !== "draai") {
      draaiDoel += vaart * dt * 60;
      vaart *= Math.pow(0.93, dt * 60);
      if (Math.abs(vaart) < 0.0002) vaart = 0;
      if (!kaal && nu() - laatsteActie > 4000) draaiDoel += 0.1 * dt;
    }
    draai += (draaiDoel - draai) * soepel(0.09);
    zoom += (zoomDoel - zoom) * soepel(0.08);

    const vlak = Math.cos(ELEV) * zoom;
    cam.position.set(midden.x + Math.sin(draai) * vlak,
                     Math.sin(ELEV) * zoom,
                     midden.z + Math.cos(draai) * vlak);
    cam.lookAt(midden.x, 0.4, midden.z);

    /* aanwijzen */
    straal.setFromCamera(muis, cam);
    const raak = straal.intersectObjects(spelden, true);
    const nieuw = raak.length ? raak[0].object.parent.userData.i : -1;
    if (nieuw !== hover) {
      hover = nieuw;
      canvas.style.cursor = hover >= 0 ? "pointer" : "grab";
      document.querySelectorAll(".locrij").forEach(r =>
        r.classList.toggle("aangewezen", +r.dataset.i === hover));
    }
    if (label) {
      if (hover >= 0) {
        const g = spelden.find(s => s.userData.i === hover);
        scherm.copy(g.position); scherm.y += 1.9; scherm.project(cam);
        const r = canvas.getBoundingClientRect();
        label.style.left = ((scherm.x * 0.5 + 0.5) * r.width) + "px";
        label.style.top = ((-scherm.y * 0.5 + 0.5) * r.height) + "px";
        label.textContent = g.userData.loc.plaats;
        label.classList.add("aan");
      } else {
        label.classList.remove("aan");
      }
    }
    rend.render(scene, cam);
  }
  maat();
  zoom = PAS * 1.9;
  zoomDoel = PAS;
  tik();
}

/* ============ MEDEWERKERSPAGINA ============ */
const REL_REPO = "https://github.com/truckwashgroup/truckwash-dashboard";

const REL_API = "https://api.github.com/repos/truckwashgroup/truckwash-dashboard/releases?per_page=20";

const REL_MAANDEN = ["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];

/* Binaire MB, want dat is het getal dat de verkenner na het downloaden laat
   zien. Decimaal zou van 130606634 bytes "131 MB" maken en dan klopt het niet
   meer met wat er op de schijf staat. */
function relGrootte(bytes) {
  const b = Number(bytes);
  if (!isFinite(b) || b <= 0) return "";
  const mb = b / 1048576;
  /* Onder een megabyte in kB, anders staat er "0,0 MB". Dat kan met de huidige
     bestanden niet gebeuren -- relAsset laat alleen de installer en de APK door
     -- maar een maat die nul zegt over een bestand dat bestaat is erger dan een
     regel code. */
  if (mb < 1) return Math.max(1, Math.round(b / 1024)) + " kB";
  return (mb >= 100 ? String(Math.round(mb)) : mb.toFixed(1).replace(".", ",")) + " MB";
}

/* Bewust geen toLocaleDateString: die volgt de taalinstelling van het toestel
   en zet op een Nederlandse pagina zo "September 2" neer. DAGEN hierboven wordt
   om dezelfde reden met de hand aangehouden.
   Dit mag wel in de gebakken HTML: het maakt een VASTE datum op en rekent niets
   uit ten opzichte van nu. Dat is het verschil met de open/dicht-badge. */
function relDatumNl(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.getDate() + " " + REL_MAANDEN[d.getMonth()] + " " + d.getFullYear();
}

function relNieuwer(a, b) {
  const x = String(a).split("."), y = String(b).split(".");
  for (let i = 0; i < 3; i++) {
    const p = Number(x[i]) || 0, q = Number(y[i]) || 0;
    if (p !== q) return p > q;
  }
  return false;
}

/* Alleen bestanden die we kennen, en alleen van het adres waar ze horen te
   staan. Een lijst uitzonderingen ("alles behalve latest.yml en .blockmap")
   breekt zodra electron-builder een vierde bestand meelevert; deze test laat
   alleen binnen wat we willen. .exe.blockmap eindigt niet op .exe en valt er
   dus vanzelf af. De prefixcontrole op het adres is de tweede lijn: dit
   antwoord komt van buiten en wordt straks een href. */
function relAsset(release, achtervoegsel) {
  const prefix = REL_REPO + "/releases/download/";
  const lijst = (release && release.assets) || [];
  for (let i = 0; i < lijst.length; i++) {
    const naam = String(lijst[i].name || "");
    const url = String(lijst[i].browser_download_url || "");
    if (naam.toLowerCase().slice(-achtervoegsel.length) !== achtervoegsel) continue;
    if (naam.slice(0, 10).toLowerCase() !== "truckwash1") continue;
    if (url.indexOf(prefix) !== 0) continue;
    return { naam: naam, url: url, bytes: Number(lijst[i].size) || 0 };
  }
  return null;
}

/* Bouwt een regel voor de versielijst. Alles via createElement en textContent:
   deze gegevens komen van een server buiten ons, en er is geen enkel pad waar
   ze als HTML ontleed worden. Dat is sterker dan ontsmetten -- een filter kun
   je omzeilen, een ontbrekende ontleder niet. */
function relRij(versie, iso, win, apk) {
  const rij = document.createElement("div");
  rij.className = "relrij";
  const vi = document.createElement("div");
  vi.className = "vi";
  const h = document.createElement("h3");
  h.textContent = versie;
  const dat = document.createElement("span");
  dat.className = "reldatum";
  dat.textContent = relDatumNl(iso);
  h.appendChild(dat);
  vi.appendChild(h);
  rij.appendChild(vi);
  const dl = document.createElement("div");
  dl.className = "reldl";
  [[win, "Windows"], [apk, "Android"]].forEach(paar => {
    if (!paar[0]) return;
    const a = document.createElement("a");
    a.href = paar[0].url;
    a.textContent = paar[1];
    dl.appendChild(a);
  });
  rij.appendChild(dl);
  return rij;
}

/* Werkt de gebakken releasegegevens bij zodra de bezoeker de pagina opent.
   Zonder dit is de pagina al bruikbaar: de knoppen wijzen dan naar de versie
   die bij de laatste sitebouw de nieuwste was, mét de datum erbij, zodat er
   niets staat dat doet alsof het van vandaag is.

   De STATISCH-rem is geen luxe. webbouw.cjs draait dit hele bestand in een VM
   en roept teken() aan, dus naTekenen() draait mee tijdens de bouw. In die VM
   bestaat fetch niet, en getElementById geeft er een proxy terug die ALTIJD
   waar is -- een controle op "staat dat element er wel" houdt dus niets tegen.
   Zonder deze ene regel valt de hele sitebouw om en is er geen enkele pagina
   meer. */
function vulReleases() {
  if (typeof STATISCH !== "undefined" && STATISCH) return;
  if (typeof fetch === "undefined") return;
  const stand = document.getElementById("relstand");
  const lijst = document.getElementById("rellijst");
  if (!stand || !lijst) return;

  const melden = tekst => {
    const m = document.getElementById("relmelding");
    if (!m) return;
    m.textContent = tekst;
    m.hidden = !tekst;
  };

  const zetKnop = (id, infoId, asset, label) => {
    const knop = document.getElementById(id);
    if (!knop || !asset) return;
    knop.href = asset.url;
    knop.textContent = label;
    const info = document.getElementById(infoId);
    if (info) info.textContent = asset.naam + " · " + relGrootte(asset.bytes);
  };

  const toon = releases => {
    const goed = releases.filter(r => r && !r.draft && !r.prerelease &&
      /^v?\d+\.\d+\.\d+$/.test(String(r.tag_name || "")));
    if (!goed.length) return;
    const nieuwste = goed[0];
    const versie = String(nieuwste.tag_name).replace(/^v/, "");
    stand.textContent = "Nieuwste versie " + versie + ", uitgebracht op " +
      relDatumNl(nieuwste.published_at) + ".";
    zetKnop("dl-win", "dl-win-info", relAsset(nieuwste, ".exe"), "Windows-installer");
    zetKnop("dl-apk", "dl-apk-info", relAsset(nieuwste, ".apk"), "Android (APK)");

    /* Alleen versies die NIEUWER zijn dan wat er gebakken staat komen erbij.
       De hele lijst opnieuw opbouwen zou de koppen weggooien, en die komen niet
       van GitHub: de release-tekst daar is voor elke versie hetzelfde sjabloon.
       De koppen komen uit de commits en worden bij het bouwen meegebakken. */
    const gebakken = lijst.getAttribute("data-nieuwste") || "";
    const extra = gebakken ? goed.filter(r =>
      relNieuwer(String(r.tag_name).replace(/^v/, ""), gebakken)) : goed;
    if (!extra.length) return;
    const leeg = document.getElementById("relleeg");
    if (leeg) leeg.remove();
    for (let i = extra.length - 1; i >= 0; i--) {
      const r = extra[i];
      lijst.insertBefore(relRij(String(r.tag_name).replace(/^v/, ""), r.published_at,
        relAsset(r, ".exe"), relAsset(r, ".apk")), lijst.firstChild);
    }
    lijst.setAttribute("data-nieuwste", versie);
    const oud = lijst.querySelector(".relnu");
    if (oud) oud.remove();
    const kop = lijst.querySelector(".relrij h3");
    if (kop) {
      const b = document.createElement("span");
      b.className = "relnu";
      b.textContent = "nieuwste";
      kop.appendChild(b);
    }
  };

  /* Tien minuten in sessionStorage, zodat rondklikken op de site het quotum niet
     leegtrekt. Dat quotum is 60 per uur per IP-adres en wordt gedeeld met elke
     Android-tablet op hetzelfde kantoor, want die vraagt zelf ook naar releases.
     In een privevenster kan sessionStorage gooien, vandaar de try. */
  try {
    const o = JSON.parse(sessionStorage.getItem("tw_releases") || "null");
    if (o && Date.now() - o.t < 600000 && Array.isArray(o.r)) { toon(o.r); return; }
  } catch (e) { /* geen buffer, gewoon ophalen */ }

  fetch(REL_API, { headers: { Accept: "application/vnd.github+json" } })
    .then(a => {
      if (a.status === 403 || a.status === 429) {
        const reset = Number(a.headers.get("x-ratelimit-reset")) * 1000;
        const min = Math.ceil((reset - Date.now()) / 60000);
        const e = new Error("limiet");
        /* Niet elke 403 draagt die kopregel; zonder deze controle stond er
           "over NaN minuten opnieuw". */
        e.minuten = isFinite(min) && min > 0 ? min : 0;
        throw e;
      }
      if (!a.ok) throw new Error("status " + a.status);
      return a.json();
    })
    .then(r => {
      if (!Array.isArray(r)) throw new Error("geen lijst");
      try {
        sessionStorage.setItem("tw_releases", JSON.stringify({ t: Date.now(), r: r }));
      } catch (e) { /* vol of geweigerd, niet erg */ }
      toon(r);
    })
    .catch(e => {
      melden(e && e.minuten
        ? "GitHub laat even geen verzoeken meer toe. Over " + e.minuten +
          " minuten kan het weer. Hieronder staat de stand van de laatste sitebouw."
        : "De actuele lijst is nu niet op te halen. Hieronder staat de stand van de laatste sitebouw.");
    });
}

/* Het adres van de edge function "trucky" in het dashboardproject. Hetzelfde
   adres staat in assets/trucky.js, maar daar zit het in een afgesloten functie
   en trucky.js is met opzet een los bestand dat niemand aanraakt -- dus hier
   nog een keer, met de reden erbij. Het formulier "Klant worden" op /contact/
   stuurt zijn aanmelding als contactverzoek naar diezelfde functie. Daardoor
   komt het op precies dezelfde plek binnen als wat Trucky zelf doorgeeft: in
   het dashboard bij Administratie en Management (tabel trucky_contact) en per
   mail. Er staat geen sleutel in; de functie is open en bewaakt zichzelf. */
const TRUCKY_ADRES = "https://yxsbmhavnttswxczeovt.supabase.co/functions/v1/trucky";

/* Het formulier "Klant worden" op /contact/ aansluiten. Gaat als contactverzoek
   naar de trucky-functie (TRUCKY_ADRES), met dezelfde velden als het formulier
   dat Trucky in de chat toont. Het verschil zit in `vraag`: die begint met een
   vaste kop KLANT WORDEN en het aantal wagens en de vestiging, zodat wie het
   in het dashboard opent in een oogopslag ziet dat dit geen vraag is maar een
   aanmelding. Het gespreks-id moet van de functie aan /^[a-z0-9-]{8,64}$/
   voldoen; er is hier geen gesprek, dus het wordt "klant-" met wat toevals-
   tekens -- lang genoeg, en aan het voorvoegsel is het in de tabel te
   herkennen. De bevestiging gaat via textContent: wat de server terugzegt is
   tekst, geen HTML. In de statische bouw is er geen document om aan te hangen
   en stapt hij er meteen uit. */
function klantWordenFormulier() {
  if (typeof STATISCH !== "undefined" && STATISCH) return;
  const f = document.getElementById("klantform");
  if (!f) return;
  const melding = document.getElementById("klantmelding");
  const w = id => { const el = document.getElementById(id); return el && el.value ? String(el.value).trim() : ""; };
  const zeg = (tekst, klasse) => { melding.textContent = tekst; melding.className = "klantmelding" + (klasse ? " " + klasse : ""); };
  f.addEventListener("submit", e => {
    e.preventDefault();
    const knop = f.querySelector("button[type=submit]");
    const gesprek = "klant-" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    const vraag = "KLANT WORDEN\nWagens: " + (w("kwagens") || "onbekend") +
      "\nVestiging: " + (w("kvest") || "geen voorkeur") + "\n\n" + (w("kopm") || "(geen opmerking)");
    knop.disabled = true;
    knop.textContent = "Versturen\u2026";
    zeg("");
    fetch(TRUCKY_ADRES, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gesprek, actie: "contact",
        naam: w("knaam"), email: w("kmail"), telefoon: w("ktel"), bedrijf: w("kbedrijf"),
        vraag, beurten: [],
      }),
    })
      .then(r => r.json())
      .then(a => {
        if (a && a.ok) {
          f.hidden = true;
          zeg("Bedankt, je aanmelding is binnen. Je krijgt een bevestiging per mail en een collega belt je terug. Heb je haast? Bel 088 - 0600 100.", "gelukt");
          return;
        }
        knop.disabled = false;
        knop.textContent = "Aanmelding versturen";
        zeg((a && a.reden) || "Versturen lukte niet. Probeer het zo nog eens, of bel 088 - 0600 100.", "mislukt");
      })
      .catch(() => {
        knop.disabled = false;
        knop.textContent = "Aanmelding versturen";
        zeg("Geen verbinding. Probeer het zo nog eens, of bel 088 - 0600 100.", "mislukt");
      });
  });
}


/* ---------- opstarten ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const ham = document.getElementById("hamburger");
  if (ham) ham.addEventListener("click", () => {
    const m = document.getElementById("menu");
    ham.setAttribute("aria-expanded", String(m.classList.toggle("open")));
  });

  const cv = document.getElementById("drie");
  if (cv && window.THREE) bouwHero3D(cv);
  const wc = document.getElementById("wascanvas");
  if (wc && window.THREE) bouwWas3D(wc);
  onthulBijScroll();
  telOp();
  /* De open/dicht-badge en de dagmarkering staan als vaste tekst in de
     gegenereerde HTML, met de bouwdatum erin. Hier zetten we ze goed. */
  ijkOpeningstijden();
  /* Alleen /medewerkers/ heeft deze elementen; overal elders stapt hij er
     meteen weer uit. */
  vulReleases();

  const pc = document.getElementById("pc");
  if (pc) {
    const uit = document.getElementById("uitkomst");
    const zoek = () => {
      const v = (pc.value || "").replace(/\D/g, "").slice(0, 4);
      if (v.length < 4) { uit.textContent = "Vul vier cijfers in, bijvoorbeeld 5651."; return; }
      const co = pcCoord(v);
      /* Onbekende postcode eerlijk melden in plaats van er stilzwijgend een
         willekeurige vestiging bij te zoeken. */
      if (!co) { uit.textContent = "Deze postcode kennen we niet. Kies hieronder zelf een vestiging."; return; }
      const met = DATA.locaties.filter(l => l.lat != null);
      let best = met[0], d = 1e9;
      met.forEach(l => { const k = afstandKm(co, [l.lat, l.lng]); if (k < d) { d = k; best = l; } });
      const st = openNu(best);
      uit.innerHTML = 'Dichtstbijzijnd: <a href="/locaties/' + esc(best.slug) + '/">' + esc(best.plaats) +
        '</a> — ' + esc(best.straat) + ' · <span class="km">ca. ' + Math.round(d) + ' km</span><br>' +
        '<span style="color:#a7b9d9;font-size:14.5px">' + st.tekst + '</span>';
    };
    const zk = document.getElementById("zoekknop");
    if (zk) zk.addEventListener("click", zoek);
    pc.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); zoek(); } });
  }

  const sel = document.getElementById("voertuig");
  if (sel) {
    const bedragEl = document.getElementById("bedrag");
    const zet = () => { bedragEl.textContent = sel.value; };
    const voorkeur = [...sel.options].find(o => o.textContent.trim().toLowerCase() === "trekker + oplegger")
                 || [...sel.options].find(o => /^trekker \+ oplegger/i.test(o.textContent.trim()));
    if (voorkeur) voorkeur.selected = true;
    sel.addEventListener("change", zet); zet();
  }

  const kv = document.getElementById("nlkaart");
  if (kv && window.THREE) {
    bouwKaart3D(kv, DATA.locaties, i => { location.href = "/locaties/" + DATA.locaties[i].slug + "/"; });
    document.querySelectorAll(".locrij").forEach(r => {
      r.addEventListener("mouseenter", () => { if (kaart3d) kaart3d.kies(+r.dataset.i); });
      r.addEventListener("mouseleave", () => { if (kaart3d) kaart3d.kies(-1); });
      r.addEventListener("focus", () => { if (kaart3d) kaart3d.naar(+r.dataset.i); });
    });
    document.querySelectorAll("[data-kaart]").forEach(b => b.addEventListener("click", () => {
      if (!kaart3d) return;
      if (b.dataset.kaart === "in") kaart3d.zoomIn();
      else if (b.dataset.kaart === "uit") kaart3d.zoomUit();
      else kaart3d.herstel();
    }));
  }

  const zoekveld = document.getElementById("prijszoek");
  if (zoekveld) {
    const chips = [...document.querySelectorAll(".chip")];
    const blokken = [...document.querySelectorAll(".tabelblok")];
    const telling = document.getElementById("telling");
    let tab = 0;
    const ververs = () => {
      const q = zoekveld.value.trim().toLowerCase();
      let n = 0;
      blokken.forEach((b, i) => {
        const zichtbaar = q ? true : i === tab;
        b.style.display = zichtbaar ? "" : "none";
        if (!zichtbaar) return;
        let raak = 0;
        b.querySelectorAll("tbody tr").forEach(tr => {
          const hit = !q || tr.cells[0].textContent.toLowerCase().includes(q);
          tr.classList.toggle("verborgen", !hit);
          if (hit) raak++;
        });
        if (q && raak === 0) b.style.display = "none"; else n += raak;
      });
      telling.textContent = q
        ? n + (n === 1 ? " tarief" : " tarieven") + ' gevonden voor "' + zoekveld.value.trim() + '"'
        : n + " tarieven in deze categorie";
      chips.forEach((c, i) => c.setAttribute("aria-pressed", String(!q && i === tab)));
    };
    chips.forEach(c => c.addEventListener("click", () => { tab = +c.dataset.tab; zoekveld.value = ""; ververs(); }));
    zoekveld.addEventListener("input", ververs);
    ververs();
  }

  const cf = document.getElementById("contactform");
  if (cf) cf.addEventListener("submit", e => {
    e.preventDefault();
    const w = id => document.getElementById(id).value.trim();
    const body = ["Naam: " + w("cnaam"), "Bedrijf: " + w("cbedrijf"), "E-mail: " + w("cmail"),
                  "Telefoon: " + w("ctel"), "Vestiging: " + (w("cvest") || "geen voorkeur"), "", w("cbericht")].join("\n");
    location.href = "mailto:info@truckwash1group.nl?subject=" +
      encodeURIComponent("Bericht via de website - " + w("cnaam")) + "&body=" + encodeURIComponent(body);
  });

  /* Alleen /contact/ heeft #klantform; overal elders stapt hij er meteen uit. */
  klantWordenFormulier();
});
