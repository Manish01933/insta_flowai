"""
PDF Report Generator
Generates premium Kundli analysis PDF reports
"""
import os
from datetime import datetime
from typing import Dict, List, Any
from bot.config import BOT_NAME, BOT_TITLE
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, black
from reportlab.lib.enums import TA_CENTER, TA_LEFT


class PremiumKundliReport:
    """
    Premium Kundli Analysis PDF Report Generator
    """
    
    def __init__(self, user_data: Dict, astrology_data: Dict, numerology_data: Dict):
        """
        Initialize PDF Report Generator
        
        Args:
            user_data: User information
            astrology_data: Astrological calculations
            numerology_data: Numerology calculations
        """
        self.user_data = user_data
        self.astrology_data = astrology_data
        self.numerology_data = numerology_data
        self.filename = f"Premium_Kundli_{user_data.get('user_id', 'user')}_{datetime.now().strftime('%Y%m%d')}.pdf"
    
    def generate_report(self) -> str:
        """
        Generate complete premium PDF report
        
        Returns:
            Path to generated PDF file
        """
        doc = SimpleDocTemplate(
            self.filename,
            pagesize=A4,
            rightMargin=72,
            leftMargin=72,
            topMargin=72,
            bottomMargin=72
        )
        
        styles = getSampleStyleSheet()
        elements = []
        
        # Cover Page
        elements.extend(self._create_cover_page(styles))
        
        # Personal Details
        elements.extend(self._create_personal_details_section(styles))
        
        # Birth Chart Analysis
        elements.extend(self._create_birth_chart_section(styles))
        
        # Planetary Positions
        elements.extend(self._create_planetary_positions_section(styles))
        
        # Dasha Analysis
        elements.extend(self._create_dasha_analysis_section(styles))
        
        # Yoga Analysis
        elements.extend(self._create_yoga_analysis_section(styles))
        
        # Numerology Profile
        elements.extend(self._create_numerology_section(styles))
        
        # 10-Year Predictions
        elements.extend(self._create_predictions_section(styles))
        
        # Remedies
        elements.extend(self._create_remedies_section(styles))
        
        # Gemstone Recommendations
        elements.extend(self._create_gemstone_section(styles))
        
        # Signature Section
        elements.extend(self._create_signature_section(styles))
        
        # Build PDF
        doc.build(elements)
        
        return self.filename
    
    def _create_cover_page(self, styles) -> List:
        """Create premium cover page"""
        elements = []
        
        # Custom title style
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=24,
            textColor=HexColor('#8B0000'),
            spaceAfter=30,
            alignment=TA_CENTER,
            fontName='Helvetica-Bold'
        )
        
        # Add title
        elements.append(Paragraph("🙏 PREMIUM KUNDLI ANALYSIS 🙏", title_style))
        elements.append(Spacer(1, 0.5*inch))
        
        # Subtitle
        subtitle_style = ParagraphStyle(
            'CustomSubtitle',
            parent=styles['Normal'],
            fontSize=14,
            textColor=HexColor('#333333'),
            alignment=TA_CENTER,
            spaceAfter=10
        )
        
        elements.append(Paragraph(
            "Complete Vedic Astrology & Numerology Report",
            subtitle_style
        ))
        elements.append(Spacer(1, 0.3*inch))
        
        elements.append(Paragraph(
            f"By {BOT_NAME}",
            subtitle_style
        ))
        elements.append(Spacer(1, 0.5*inch))
        
        elements.append(Paragraph(
            "52+ Years of Experience | 18,000+ Clients Guided",
            subtitle_style
        ))
        elements.append(Spacer(1, 0.5*inch))
        
        # Report date
        date_style = ParagraphStyle(
            'DateStyle',
            parent=styles['Normal'],
            fontSize=11,
            textColor=HexColor('#666666'),
            alignment=TA_CENTER
        )
        
        elements.append(Paragraph(
            f"Report Generated: {datetime.now().strftime('%d %B, %Y')}",
            date_style
        ))
        
        return elements
    
    def _create_personal_details_section(self, styles) -> List:
        """Create personal details section"""
        elements = []
        
        # Section header
        header_style = ParagraphStyle(
            'SectionHeader',
            parent=styles['Heading2'],
            fontSize=18,
            textColor=HexColor('#8B0000'),
            spaceAfter=20,
            fontName='Helvetica-Bold'
        )
        
        elements.append(Paragraph("📋 Personal Details", header_style))
        elements.append(Spacer(1, 0.2*inch))
        
        # Details table
        details = [
            ['Full Name', self.user_data.get('first_name', 'N/A')],
            ['Date of Birth', self.user_data.get('birth_date', 'N/A')],
            ['Time of Birth', self.user_data.get('birth_time', 'N/A')],
            ['Place of Birth', self.user_data.get('birth_place', 'N/A')],
            ['Report Date', datetime.now().strftime('%d-%m-%Y')]
        ]
        
        table = Table(details, colWidths=[2*inch, 3*inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), HexColor('#8B0000')),
            ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#FFFFFF')),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 12),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('TOPPADDING', (0, 1), (-1, -1), 6),
            ('GRID', (0, 0), (-1, -1), 1, HexColor('#CCCCCC'))
        ]))
        
        elements.append(table)
        elements.append(Spacer(1, 0.3*inch))
        
        return elements
    
    def _create_birth_chart_section(self, styles) -> List:
        """Create birth chart section"""
        elements = []
        
        header_style = ParagraphStyle(
            'SectionHeader',
            parent=styles['Heading2'],
            fontSize=18,
            textColor=HexColor('#8B0000'),
            spaceAfter=20,
            fontName='Helvetica-Bold'
        )
        
        elements.append(Paragraph("🔮 Birth Chart Analysis", header_style))
        elements.append(Spacer(1, 0.2*inch))
        
        # Get data
        rashi = self.astrology_data.get('rashi', 'N/A')
        lagna = self.astrology_data.get('lagna', 'N/A')
        nakshatra = self.astrology_data.get('nakshatra', 'N/A')
        dasha = self.astrology_data.get('mahadasha', {})
        
        chart_data = [
            ['Moon Sign (Rashi)', rashi],
            ['Ascendant (Lagna)', lagna],
            ['Nakshatra', nakshatra],
            ['Current Mahadasha', dasha.get('mahadasha', 'N/A') if isinstance(dasha, dict) else dasha],
            ['Current Antardasha', dasha.get('antardasha', 'N/A') if isinstance(dasha, dict) else 'N/A']
        ]
        
        table = Table(chart_data, colWidths=[2*inch, 3*inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), HexColor('#8B0000')),
            ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#FFFFFF')),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 12),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('TOPPADDING', (0, 1), (-1, -1), 6),
            ('GRID', (0, 0), (-1, -1), 1, HexColor('#CCCCCC'))
        ]))
        
        elements.append(table)
        elements.append(Spacer(1, 0.3*inch))
        
        return elements
    
    def _create_planetary_positions_section(self, styles) -> List:
        """Create planetary positions section"""
        elements = []
        
        header_style = ParagraphStyle(
            'SectionHeader',
            parent=styles['Heading2'],
            fontSize=18,
            textColor=HexColor('#8B0000'),
            spaceAfter=20,
            fontName='Helvetica-Bold'
        )
        
        elements.append(Paragraph("🪐 Planetary Positions", header_style))
        elements.append(Spacer(1, 0.2*inch))
        
        planetary_data = self.astrology_data.get('planetary_positions', {})
        
        if planetary_data:
            positions = [['Planet', 'Position']]
            for planet, position in planetary_data.items():
                positions.append([planet, position])
            
            table = Table(positions, colWidths=[1.5*inch, 3.5*inch])
            table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), HexColor('#8B0000')),
                ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#FFFFFF')),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 11),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
                ('TOPPADDING', (0, 1), (-1, -1), 6),
                ('GRID', (0, 0), (-1, -1), 1, HexColor('#CCCCCC'))
            ]))
            
            elements.append(table)
        else:
            elements.append(Paragraph("Planetary positions analysis available in detailed report.", styles['Normal']))
        
        elements.append(Spacer(1, 0.3*inch))
        
        return elements
    
    def _create_dasha_analysis_section(self, styles) -> List:
        """Create Dasha analysis section"""
        elements = []
        
        header_style = ParagraphStyle(
            'SectionHeader',
            parent=styles['Heading2'],
            fontSize=18,
            textColor=HexColor('#8B0000'),
            spaceAfter=20,
            fontName='Helvetica-Bold'
        )
        
        elements.append(Paragraph("⏰ Dasha Analysis", header_style))
        elements.append(Spacer(1, 0.2*inch))
        
        dasha_info = self.astrology_data.get('mahadasha', {})
        
        if isinstance(dasha_info, dict):
            mahadasha = dasha_info.get('mahadasha', 'N/A')
            antardasha = dasha_info.get('antardasha', 'N/A')
        else:
            mahadasha = str(dasha_info)
            antardasha = 'N/A'
        
        # Dasha description
        dasha_descriptions = {
            'Ketu': 'Ketu Mahadasha brings spiritual growth, detachment, and inner transformation.',
            'Venus': 'Venus Mahadasha brings luxury, relationships, creativity, and material comforts.',
            'Sun': 'Sun Mahadasha brings authority, leadership, confidence, and recognition.',
            'Moon': 'Moon Mahadasha brings emotional experiences, family matters, and mental peace.',
            'Mars': 'Mars Mahadasha brings energy, courage, competition, and property matters.',
            'Rahu': 'Rahu Mahadasha brings sudden changes, foreign connections, and unconventional experiences.',
            'Jupiter': 'Jupiter Mahadasha brings wisdom, prosperity, growth, and spiritual knowledge.',
            'Saturn': 'Saturn Mahadasha brings discipline, hard work, delays, and karmic lessons.',
            'Mercury': 'Mercury Mahadasha brings intelligence, communication, business, and learning.'
        }
        
        description = dasha_descriptions.get(mahadasha, 'Current planetary period influences your life.')
        
        elements.append(Paragraph(
            f"<b>Current Mahadasha:</b> {mahadasha}",
            styles['Normal']
        ))
        elements.append(Paragraph(
            f"<b>Current Antardasha:</b> {antardasha}",
            styles['Normal']
        ))
        elements.append(Spacer(1, 0.1*inch))
        elements.append(Paragraph(
            description,
            styles['Normal']
        ))
        
        elements.append(Spacer(1, 0.3*inch))
        
        return elements
    
    def _create_yoga_analysis_section(self, styles) -> List:
        """Create Yoga analysis section"""
        elements = []
        
        header_style = ParagraphStyle(
            'SectionHeader',
            parent=styles['Heading2'],
            fontSize=18,
            textColor=HexColor('#8B0000'),
            spaceAfter=20,
            fontName='Helvetica-Bold'
        )
        
        elements.append(Paragraph("✨ Yoga Analysis", header_style))
        elements.append(Spacer(1, 0.2*inch))
        
        yogas = self.astrology_data.get('yogas', [])
        
        if yogas:
            for yoga in yogas:
                elements.append(Paragraph(
                    f"<b>{yoga.get('name', 'Yoga')}:</b> {yoga.get('description', '')}",
                    styles['Normal']
                ))
                elements.append(Spacer(1, 0.1*inch))
        else:
            elements.append(Paragraph("Yoga analysis available in detailed report.", styles['Normal']))
        
        elements.append(Spacer(1, 0.3*inch))
        
        return elements
    
    def _create_numerology_section(self, styles) -> List:
        """Create Numerology profile section"""
        elements = []
        
        header_style = ParagraphStyle(
            'SectionHeader',
            parent=styles['Heading2'],
            fontSize=18,
            textColor=HexColor('#8B0000'),
            spaceAfter=20,
            fontName='Helvetica-Bold'
        )
        
        elements.append(Paragraph("🔢 Numerology Profile", header_style))
        elements.append(Spacer(1, 0.2*inch))
        
        # Life Path Number
        life_path = self.numerology_data.get('life_path', 0)
        elements.append(Paragraph(
            f"<b>Life Path Number:</b> {life_path}",
            styles['Normal']
        ))
        
        # Lucky Numbers
        lucky_numbers = self.numerology_data.get('lucky_numbers', [])
        if lucky_numbers:
            elements.append(Paragraph(
                f"<b>Lucky Numbers:</b> {', '.join(map(str, lucky_numbers))}",
                styles['Normal']
            ))
        
        # Lucky Colors
        lucky_colors = self.numerology_data.get('lucky_colors', [])
        if lucky_colors:
            elements.append(Paragraph(
                f"<b>Lucky Colors:</b> {', '.join(lucky_colors)}",
                styles['Normal']
            ))
        
        elements.append(Spacer(1, 0.3*inch))
        
        return elements
    
    def _create_predictions_section(self, styles) -> List:
        """Create 10-year predictions section"""
        elements = []
        
        header_style = ParagraphStyle(
            'SectionHeader',
            parent=styles['Heading2'],
            fontSize=18,
            textColor=HexColor('#8B0000'),
            spaceAfter=20,
            fontName='Helvetica-Bold'
        )
        
        elements.append(Paragraph("📅 10-Year Predictions", header_style))
        elements.append(Spacer(1, 0.2*inch))
        
        current_year = datetime.now().year
        
        for year in range(current_year, current_year + 10):
            year_style = ParagraphStyle(
                'YearHeader',
                parent=styles['Heading3'],
                fontSize=14,
                textColor=HexColor('#8B0000'),
                spaceAfter=10,
                fontName='Helvetica-Bold'
            )
            
            elements.append(Paragraph(f"Year {year}", year_style))
            
            # Generate predictions for this year
            predictions = self._generate_year_predictions(year)
            
            prediction_text = f"""
<b>Career:</b> {predictions['career']}

<b>Finance:</b> {predictions['finance']}

<b>Relationship:</b> {predictions['relationship']}

<b>Health:</b> {predictions['health']}
"""
            
            elements.append(Paragraph(prediction_text, styles['Normal']))
            elements.append(Spacer(1, 0.15*inch))
            elements.append(Paragraph("─" * 80, styles['Normal']))
            elements.append(Spacer(1, 0.15*inch))
        
        return elements
    
    def _generate_year_predictions(self, year: int) -> Dict[str, str]:
        """Generate predictions for a specific year"""
        # Simplified predictions - in production, use detailed calculations
        predictions = {
            'career': 'Focus on skill development and networking. Opportunities may arise mid-year.',
            'finance': 'Financial stability with potential for growth. Avoid impulsive investments.',
            'relationship': 'Harmony in relationships. Good time for strengthening bonds.',
            'health': 'Maintain regular exercise and balanced diet. Watch for stress-related issues.'
        }
        
        return predictions
    
    def _create_remedies_section(self, styles) -> List:
        """Create personalized remedies section"""
        elements = []
        
        header_style = ParagraphStyle(
            'SectionHeader',
            parent=styles['Heading2'],
            fontSize=18,
            textColor=HexColor('#8B0000'),
            spaceAfter=20,
            fontName='Helvetica-Bold'
        )
        
        elements.append(Paragraph("🙏 Personalized Remedies", header_style))
        elements.append(Spacer(1, 0.2*inch))
        
        # General remedies
        remedies = [
            {
                'planet': 'General',
                'description': 'Practice daily meditation for 15 minutes to maintain mental peace.',
                'mantra': 'ॐ नमः शिवाय',
                'timing': 'Every morning after bath'
            },
            {
                'planet': 'Wealth',
                'description': 'Keep a clean and organized workspace. Donate on Fridays.',
                'mantra': 'ॐ शं शनैश्चराय नमः',
                'timing': 'Every Friday'
            },
            {
                'planet': 'Health',
                'description': 'Practice yoga and maintain a balanced diet. Avoid excessive spice.',
                'mantra': 'ॐ त्र्यम्बकं यजामहे',
                'timing': 'Daily'
            }
        ]
        
        for remedy in remedies:
            elements.append(Paragraph(
                f"<b>{remedy['planet']}:</b> {remedy['description']}",
                styles['Normal']
            ))
            elements.append(Paragraph(
                f"<b>Mantra:</b> {remedy['mantra']}",
                styles['Normal']
            ))
            elements.append(Paragraph(
                f"<b>Timing:</b> {remedy['timing']}",
                styles['Normal']
            ))
            elements.append(Spacer(1, 0.15*inch))
            elements.append(Paragraph("─" * 80, styles['Normal']))
            elements.append(Spacer(1, 0.15*inch))
        
        return elements
    
    def _create_gemstone_section(self, styles) -> List:
        """Create gemstone recommendations section"""
        elements = []
        
        header_style = ParagraphStyle(
            'SectionHeader',
            parent=styles['Heading2'],
            fontSize=18,
            textColor=HexColor('#8B0000'),
            spaceAfter=20,
            fontName='Helvetica-Bold'
        )
        
        elements.append(Paragraph("💎 Gemstone Recommendations", header_style))
        elements.append(Spacer(1, 0.2*inch))
        
        gemstones = [
            ['Gemstone', 'Planet', 'Finger', 'Day', 'Weight'],
            ['Ruby (Manikya)', 'Sun', 'Ring Finger', 'Sunday', '3-6 carats'],
            ['Pearl (Moti)', 'Moon', 'Little Finger', 'Monday', '3-9 carats'],
            ['Yellow Sapphire (Pukhraj)', 'Jupiter', 'Index Finger', 'Thursday', '3-7 carats'],
            ['Emerald (Panna)', 'Mercury', 'Little Finger', 'Wednesday', '3-6 carats']
        ]
        
        table = Table(gemstones, colWidths=[1.2*inch, 1*inch, 1*inch, 0.8*inch, 0.8*inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), HexColor('#8B0000')),
            ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#FFFFFF')),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
            ('TOPPADDING', (0, 1), (-1, -1), 6),
            ('GRID', (0, 0), (-1, -1), 1, HexColor('#CCCCCC'))
        ]))
        
        elements.append(table)
        elements.append(Spacer(1, 0.2*inch))
        
        # Disclaimer
        disclaimer_style = ParagraphStyle(
            'Disclaimer',
            parent=styles['Italic'],
            fontSize=10,
            textColor=HexColor('#666666')
        )
        
        elements.append(Paragraph(
            "Note: Consult with an experienced astrologer before wearing any gemstone.",
            disclaimer_style
        ))
        
        elements.append(Spacer(1, 0.3*inch))
        
        return elements
    
    def _create_signature_section(self, styles) -> List:
        """Create signature section"""
        elements = []
        elements.append(Spacer(1, 0.5*inch))
        
        signature_style = ParagraphStyle(
            'Signature',
            parent=styles['Normal'],
            fontSize=14,
            textColor=HexColor('#8B0000'),
            alignment=TA_CENTER,
            spaceAfter=10,
            fontName='Helvetica-Bold'
        )
        
        elements.append(Paragraph("🙏", signature_style))
        elements.append(Paragraph(
            BOT_NAME,
            signature_style
        ))
        elements.append(Paragraph(
            BOT_TITLE,
            styles['Normal']
        ))
        elements.append(Spacer(1, 0.2*inch))
        
        contact_style = ParagraphStyle(
            'Contact',
            parent=styles['Normal'],
            fontSize=11,
            textColor=HexColor('#666666'),
            alignment=TA_CENTER
        )
        
        elements.append(Paragraph(
            "For Personal Consultation: Contact via Telegram",
            contact_style
        ))
        elements.append(Paragraph(
            f"Report ID: {self.user_data.get('user_id', 'N/A')}",
            contact_style
        ))
        
        return elements
